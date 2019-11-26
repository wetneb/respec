// @ts-check
// Module core/biblio
// Pre-processes bibliographic references
// Configuration:
//  - localBiblio: override or supplement the official biblio with your own.

import { biblioDB } from "./biblio-db.js";
import { createResourceHint } from "./utils.js";

/** @type {Conf['biblio']} */
export const biblio = {};

export const name = "core/biblio";

const bibrefsURL = new URL("https://api.specref.org/bibrefs?refs=");
const crossrefURL = new URL("https://api.crossref.org/works?filter=");

// Opportunistically dns-prefetch to bibref server, as we don't know yet
// if we will actually need to download references yet.
const link = createResourceHint({
  hint: "dns-prefetch",
  href: bibrefsURL.origin,
});
document.head.appendChild(link);
let doneResolver;

/** @type {Promise<Conf['biblio']>} */
const done = new Promise(resolve => {
  doneResolver = resolve;
});

/*
 * Fetches a set of references from Specref
 * and / or Crossref, depending on their ids
 * (Crossref ids start with "doi:").
 *
 * Returns a map from reference ids to reference
 * contents.
 */
export async function updateFromNetwork(
  refs,
  options = { forceUpdate: false }
) {
  const refsToFetch = [...new Set(refs)].filter(ref => ref.trim());
  // Split the ids by source
  const specrefIds = refsToFetch.filter(ref => !ref.startsWith("doi:"));
  const crossrefIds = refsToFetch.filter(ref => ref.startsWith("doi:"));

  // Fetch the ids
  const specrefData = await updateFromSpecref(specrefIds, options);
  const crossrefData = await updateFromCrossref(crossrefIds);

  // Store them in the indexed DB
  const data = { ...specrefData, ...crossrefData };
  // SpecRef updates every hour, so we should follow suit
  // https://github.com/tobie/specref#hourly-auto-updating
  const expires = response.headers.has("Expires")
    ? Math.min(Date.parse(response.headers.get("Expires")), oneHourFromNow)
    : oneHourFromNow;
  try {
    await biblioDB.addAll(data, expires);
  } catch (err) {
    console.error(err);
  }
  return data;
}

export async function updateFromCrossref(refsToFetch) {
  if (!refsToFetch.length || navigator.onLine === false) {
    return null;
  }
  let response;
  try {
    response = await fetch(crossrefURL.href + refsToFetch.join(","));
  } catch (err) {
    console.error(err);
    return null;
  }
  const data = await response.json();

  const keyToMetadata = data.message.items.reduce((collector, item) => {
    if (item.DOI) {
      const id = `doi:${item.DOI}`;
      item.id = id;
      delete item.reference;
      collector[id] = item;
    } else {
      console.error("Invalid DOI metadata returned by Crossref");
    }
    return collector;
  }, {});
  return keyToMetadata;
}

export async function updateFromSpecref(
  refsToFetch,
  options = { forceUpdate: false }
) {
  // Update database if needed, if we are online
  if (!refsToFetch.length || navigator.onLine === false) {
    return null;
  }
  let response;
  const oneHourFromNow = Date.now() + 1000 * 60 * 60 * 1;
  try {
    response = await fetch(bibrefsURL.href + refsToFetch.join(","));
  } catch (err) {
    console.error(err);
    return null;
  }
  if ((!options.forceUpdate && !response.ok) || response.status !== 200) {
    return null;
  }
  /** @type {Conf['biblio']} */
  const data = await response.json();
  return data;
}

/**
 * @param {string} key
 * @returns {Promise<BiblioData>}
 */
export async function resolveRef(key) {
  const biblio = await done;
  if (!biblio.hasOwnProperty(key)) {
    return null;
  }
  const entry = biblio[key];
  if (entry.aliasOf) {
    return await resolveRef(entry.aliasOf);
  }
  return entry;
}

/**
 * @param {string[]} neededRefs
 */
async function getReferencesFromIdb(neededRefs) {
  const idbRefs = [];
  // See if we have them in IDB
  try {
    await biblioDB.ready; // can throw
    const promisesToFind = neededRefs.map(async id => ({
      id,
      data: await biblioDB.find(id),
    }));
    idbRefs.push(...(await Promise.all(promisesToFind)));
  } catch (err) {
    // IndexedDB died, so we need to go to the network for all
    // references
    idbRefs.push(...neededRefs.map(id => ({ id, data: null })));
    console.warn(err);
  }

  return idbRefs;
}

export class Plugin {
  /** @param {Conf} conf */
  constructor(conf) {
    this.conf = conf;
  }

  /**
   * Normative references take precedence over informative ones,
   * so any duplicates ones are removed from the informative set.
   */
  normalizeReferences() {
    const normalizedNormativeRefs = new Set(
      [...this.conf.normativeReferences].map(key => key.toLowerCase())
    );
    Array.from(this.conf.informativeReferences)
      .filter(key => normalizedNormativeRefs.has(key.toLowerCase()))
      .forEach(redundantKey =>
        this.conf.informativeReferences.delete(redundantKey)
      );
  }

  getRefKeys() {
    return {
      informativeReferences: Array.from(this.conf.informativeReferences),
      normativeReferences: Array.from(this.conf.normativeReferences),
    };
  }

  async run() {
    const finish = () => {
      doneResolver(this.conf.biblio);
    };
    if (!this.conf.localBiblio) {
      this.conf.localBiblio = {};
    }
    this.conf.biblio = biblio;
    const localAliases = Object.keys(this.conf.localBiblio)
      .filter(key => this.conf.localBiblio[key].hasOwnProperty("aliasOf"))
      .map(key => this.conf.localBiblio[key].aliasOf)
      .filter(key => !this.conf.localBiblio.hasOwnProperty(key));
    this.normalizeReferences();
    const allRefs = this.getRefKeys();
    const neededRefs = Array.from(
      new Set(
        allRefs.normativeReferences
          .concat(allRefs.informativeReferences)
          // Filter, as to not go to network for local refs
          .filter(key => !this.conf.localBiblio.hasOwnProperty(key))
          // but include local aliases which refer to external specs
          .concat(localAliases)
          .sort()
      )
    );

    const idbRefs = neededRefs.length
      ? await getReferencesFromIdb(neededRefs)
      : [];
    const split = { hasData: [], noData: [] };
    idbRefs.forEach(ref => {
      (ref.data ? split.hasData : split.noData).push(ref);
    });
    split.hasData.forEach(ref => {
      biblio[ref.id] = ref.data;
    });
    const externalRefs = split.noData.map(item => item.id);
    if (externalRefs.length) {
      // Going to the network for refs we don't have
      const data = await updateFromNetwork(externalRefs, { forceUpdate: true });
      Object.assign(biblio, data);
    }
    Object.assign(biblio, this.conf.localBiblio);
    finish();
  }
}

export function citationMetadataToJsonld(ref) {
  if (ref.id.startsWith('doi:')) {
    return crossrefMetadataToJsonld(ref);
  } else {
    return specrefMetadataToJsonld(ref);
  }
}

/**
 * Translates specref references to JSON-LD objects
 */
function specrefMetadataToJsonld(ref) {
  const { href: id, title: name, href: url } = ref;
  const jsonld = {
    id,
    type: "TechArticle",
    name,
    url,
  };
  if (ref.authors) {
    jsonld.creator = ref.authors.map(a => ({ name: a }));
  }
  if (ref.rawDate) {
    jsonld.publishedDate = ref.rawDate;
  }
  if (ref.isbn) {
    jsonld.identifier = ref.isbn;
  }
  if (ref.publisher) {
    jsonld.publisher = { name: ref.publisher };
  }
  return jsonld;
}

/**
 * Translates Crossref references to JSON-LD objects
 */
function crossrefMetadataToJsonld(ref) {
  const {
    URL: url,
    title: name,
    subtitle: subtitle,
  } = ref;
  const jsonld = {
    url,
    name,
    subtitle,
  };
  const identifiers = [];
  if (ref.author && ref.author.length) {
    jsonld.creator = ref.author.map(crossrefAuthorToJsonld);
  }
  if (ref.publisher) {
    jsonld.publisher = {name: ref.publisher};
  }
  if (ref.DOI) {
    identifiers.push(ref.DOI);
  }
  return jsonld;
}

function crossrefAuthorToJsonld(author) {
  let { given, family, literal } = author;
  let jsonld = {
    givenName: given,
    familyName: family,
    name: literal,
  };
  if (given && family && !literal) {
    jsonld.name = `${given} ${family}`;
  } else if (family && !literal) {
    jsonld.name = family;
  }
  if (author.ORCID) {
    jsonld.sameAs = author.ORCID;
  }
  return jsonld;
}

/*
export function renderCrossrefReference(ref) {
  let title = ref.title;
  if (ref.subtitle) {
    title = `${ref.title}. ${ref.subtitle}`;
  }
  let output = `<cite>${title}</cite>`;

  output = ref.URL ? `<a href="${ref.URL}">${output}</a>. ` : `${output}. `;

  if (ref.author && ref.author.length) {
    output += ref.author.map(renderCrossrefAuthor).join(", ");
    output += ". ";
  }

  // Add bibliographic reference part
  const journalRefParts = [];
  const containerTitles = ref["container-title"];
  if (containerTitles) {
    const rendered =
      typeof containerTitles === "object"
        ? containerTitles[0]
        : containerTitles;
    journalRefParts.push(rendered);
  } else if (ref.publisher) {
    journalRefParts.push(ref.publisher);
  }
  if (ref.volume && ref.issue) {
    journalRefParts.push(`<strong>${ref.volume}</strong> (${ref.issue})`);
  }
  if (ref.page && typeof ref.page === "string") {
    journalRefParts.push(`pp. ${ref.page}`);
  }
  if (ref.issued && ref.issued["date-parts"]) {
    journalRefParts.push(ref.issued["date-parts"].join("-"));
  }
  output = `${output} ${endWithDot(journalRefParts.join(", "))} `;

  // Add identifiers
  const identifiers = [];
  if (ref.DOI)
    identifiers.push(
      `DOI:&nbsp;<a href="https://doi.org/"${ref.DOI}">${ref.DOI}</a>`
    );
  if (ref.ISBN && ref.type === "book") {
    identifiers.push(`ISBN:&nbsp;${ref.ISBN.map(formatISBN).join(", ")}`);
  }
  output = `${output} ${identifiers.join(", ")}`;

  return output;
}
*/
