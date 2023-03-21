// @ts-check
// Module core/render-biblio
// renders the biblio data pre-processed in core/biblio

import { addId, getIntlData, showError, orcidSvgHtml } from "./utils.js";
import { biblio } from "./biblio.js";
import { html } from "./import-maps.js";

export const name = "core/render-biblio";

const localizationStrings = {
  en: {
    info_references: "Informative references",
    norm_references: "Normative references",
    references: "References",
    reference_not_found: "Reference not found.",
  },
  ko: {
    references: "참조",
  },
  nl: {
    info_references: "Informatieve referenties",
    norm_references: "Normatieve referenties",
    references: "Referenties",
  },
  es: {
    info_references: "Referencias informativas",
    norm_references: "Referencias normativas",
    references: "Referencias",
    reference_not_found: "Referencia no encontrada.",
  },
  ja: {
    info_references: "参照用参考文献",
    norm_references: "規範的参考文献",
    references: "参考文献",
  },
  de: {
    info_references: "Weiterführende Informationen",
    norm_references: "Normen und Spezifikationen",
    references: "Referenzen",
  },
  zh: {
    info_references: "非规范性引用",
    norm_references: "规范性引用",
    references: "参考文献",
  },
};

const l10n = getIntlData(localizationStrings);

const REF_STATUSES = new Map([
  ["CR", "W3C Candidate Recommendation"],
  ["ED", "W3C Editor's Draft"],
  ["LCWD", "W3C Last Call Working Draft"],
  ["NOTE", "W3C Working Group Note"],
  ["PER", "W3C Proposed Edited Recommendation"],
  ["PR", "W3C Proposed Recommendation"],
  ["REC", "W3C Recommendation"],
  ["WD", "W3C Working Draft"],
]);

const endWithDot = endNormalizer(".");

/** @param {Conf} conf */
export function run(conf) {
  const informs = Array.from(conf.informativeReferences);
  const norms = Array.from(conf.normativeReferences);

  if (!informs.length && !norms.length) return;

  /** @type {HTMLElement} */
  const refSection =
    document.querySelector("section#references") ||
    html`<section id="references"></section>`;

  if (!document.querySelector("section#references > :is(h2, h1)")) {
    // We use a h1 here because this could be structured from markdown
    // which would otherwise end up in the wrong document order
    // when the document is restructured.
    refSection.prepend(html`<h1>${l10n.references}</h1>`);
  }

  refSection.classList.add("appendix");

  if (norms.length) {
    const sec = createReferencesSection(norms, l10n.norm_references);
    refSection.appendChild(sec);
  }
  if (informs.length) {
    const sec = createReferencesSection(informs, l10n.info_references);
    refSection.appendChild(sec);
  }

  document.body.appendChild(refSection);
}

/**
 * @param {string[]} refs
 * @param {string} title
 * @returns {HTMLElement}
 */
function createReferencesSection(refs, title) {
  const { goodRefs, badRefs } = groupRefs(refs.map(toRefContent));
  const uniqueRefs = getUniqueRefs(goodRefs);

  const refsToShow = uniqueRefs
    .concat(badRefs)
    .sort((a, b) =>
      a.ref.toLocaleLowerCase().localeCompare(b.ref.toLocaleLowerCase())
    );

  const sec = html`<section>
    <h3>${title}</h3>
    <dl class="bibliography">${refsToShow.map(showRef)}</dl>
  </section>`;
  addId(sec, "", title);

  const aliases = getAliases(goodRefs);
  decorateInlineReference(uniqueRefs, aliases);
  warnBadRefs(badRefs);

  return sec;
}

/**
 * returns refcontent and unique key for a reference among its aliases
 * and warns about circular references
 * @param {String} ref
 * @typedef {ReturnType<typeof toRefContent>} Ref
 */
function toRefContent(ref) {
  let refcontent = biblio[ref];
  let key = ref;
  const circular = new Set([key]);
  while (refcontent && refcontent.aliasOf) {
    if (circular.has(refcontent.aliasOf)) {
      refcontent = null;
      const msg = `Circular reference in biblio DB between [\`${ref}\`] and [\`${key}\`].`;
      showError(msg, name);
    } else {
      key = refcontent.aliasOf;
      refcontent = biblio[key];
      circular.add(key);
    }
  }
  if (refcontent && !refcontent.id) {
    refcontent.id = ref.toLowerCase();
  }
  return { ref, refcontent };
}

/** @param {Ref[]} refs */
function groupRefs(refs) {
  const goodRefs = [];
  const badRefs = [];
  for (const ref of refs) {
    if (ref.refcontent) {
      goodRefs.push(ref);
    } else {
      badRefs.push(ref);
    }
  }
  return { goodRefs, badRefs };
}

/** @param {Ref[]} refs */
function getUniqueRefs(refs) {
  /** @type {Map<string, Ref>} */
  const uniqueRefs = new Map();
  for (const ref of refs) {
    if (!uniqueRefs.has(ref.refcontent.id)) {
      // the condition ensures that only the first used [[TERM]]
      // shows up in #references section
      uniqueRefs.set(ref.refcontent.id, ref);
    }
  }
  return [...uniqueRefs.values()];
}

/**
 * Render an inline citation
 *
 * @param {String} ref the inline reference.
 * @param {String} [linkText] custom link text
 * @returns HTMLElement
 */
export function renderInlineCitation(ref, linkText) {
  const key = ref.replace(/^(!|\?)/, "");
  const href = `#bib-${key.toLowerCase()}`;
  const text = linkText || key;
  const elem = html`<cite
    ><a class="bibref" href="${href}" data-link-type="biblio">${text}</a></cite
  >`;
  return linkText ? elem : html`[${elem}]`;
}

/**
 * renders a reference
 * @param {Ref} reference
 */
function showRef(reference) {
  const { ref, refcontent } = reference;
  const refId = `bib-${ref.toLowerCase()}`;
  const result = html`
    <dt id="${refId}">[${ref}]</dt>
    <dd>
      ${refcontent
        ? { html: stringifyReference(refcontent) }
        : html`<em class="respec-offending-element"
            >${l10n.reference_not_found}</em
          >`}
    </dd>
  `;
  return result;
}

function endNormalizer(endStr) {
  return str => {
    const trimmed = str.trim();
    const result =
      !trimmed || trimmed.endsWith(endStr) ? trimmed : trimmed + endStr;
    return result;
  };
}

/** @param {BiblioData|string} ref */
function stringifyReference(ref) {
  if (typeof ref === "string") return ref;
  if (ref.id.startsWith("doi:")) {
    return renderCrossrefReference(ref);
  } else {
    return renderSpecrefReference(ref);
  }
}

export function renderSpecrefReference(ref) {
  let output = `<cite>${ref.title}</cite>`;

  output = ref.href ? `<a href="${ref.href}">${output}</a>. ` : `${output}. `;

  if (ref.authors && ref.authors.length) {
    output += ref.authors.join("; ");
    if (ref.etAl) output += " et al";
    output += ". ";
  }
  if (ref.publisher) {
    output = `${output} ${endWithDot(ref.publisher)} `;
  }
  if (ref.date) output += `${ref.date}. `;
  if (ref.status) output += `${REF_STATUSES.get(ref.status) || ref.status}. `;
  if (ref.href) output += `URL: <a href="${ref.href}">${ref.href}</a>`;
  return output;
}

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

function renderCrossrefAuthor(author) {
  let name = null;
  if (author.given && author.family) {
    name = `${author.given} ${author.family}`;
  } else if (author.family) {
    name = author.family;
  } else {
    name = author.literal;
  }
  if (name) {
    if (author.ORCID) {
        return `${name}&nbsp;<a href="${author.ORCID}">${orcidSvgHtml}</a>`;
    } else {
        return name;
    }
  }
  return null;
}

function formatISBN(isbn) {
  // TODO we could insert dashes in ISBNs where appropriate.
  // for now we just render them raw
  return isbn;
}

/**
 * get aliases for a reference "key"
 */
function getAliases(refs) {
  return refs.reduce((aliases, ref) => {
    const key = ref.refcontent.id;
    const keys = !aliases.has(key)
      ? aliases.set(key, []).get(key)
      : aliases.get(key);
    keys.push(ref.ref);
    return aliases;
  }, new Map());
}

/**
 * fix biblio reference URLs
 * Add title attribute to references
 */
function decorateInlineReference(refs, aliases) {
  refs
    .map(({ ref, refcontent }) => {
      const refUrl = `#bib-${ref.toLowerCase()}`;
      const selectors = aliases
        .get(refcontent.id)
        .map(alias => `a.bibref[href="#bib-${alias.toLowerCase()}"]`)
        .join(",");
      const elems = document.querySelectorAll(selectors);
      return { refUrl, elems, refcontent };
    })
    .forEach(({ refUrl, elems, refcontent }) => {
      elems.forEach(a => {
        a.setAttribute("href", refUrl);
        a.setAttribute("title", refcontent.title);
        a.dataset.linkType = "biblio";
      });
    });
}

/**
 * warn about bad references
 */
function warnBadRefs(refs) {
  for (const { ref } of refs) {
    /** @type {NodeListOf<HTMLElement>} */
    const links = document.querySelectorAll(
      `a.bibref[href="#bib-${ref.toLowerCase()}"]`
    );
    const elements = [...links].filter(
      ({ textContent: t }) => t.toLowerCase() === ref.toLowerCase()
    );
    const msg = `Reference "[${ref}]" not found.`;
    const hint = `Search for ["${ref}"](https://www.specref.org?q=${ref}) on Specref to see if it exists or if it's misspelled.`;
    showError(msg, name, { hint, elements });
  }
}
