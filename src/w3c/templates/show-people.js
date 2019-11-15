// @ts-check
import {
  humanDate,
  showInlineError,
  toShortIsoDate,
  orcidSvg,
} from "../../core/utils.js";
import { lang as defaultLang } from "../../core/l10n.js";
import { hyperHTML as html } from "../../core/import-maps.js";

const localizationStrings = {
  en: {
    until: "Until",
  },
  es: {
    until: "Hasta",
  },
};

const lang = defaultLang in localizationStrings ? defaultLang : "en";

export default (items = []) => {
  const l10n = localizationStrings[lang];
  return items.map(getItem);

  function getItem(p) {
    const personName = [p.name]; // treated as opt-in HTML by hyperHTML
    const company = [p.company];
    const editorid = p.w3cid ? parseInt(p.w3cid, 10) : null;
    /** @type {HTMLElement} */
    const dd = html`
      <dd class="p-author h-card vcard" data-editor-id="${editorid}"></dd>
    `;
    const span = document.createDocumentFragment();
    const contents = [];
    if (p.mailto) {
      contents.push(html`
        <a class="ed_mailto u-email email p-name" href="${`mailto:${p.mailto}`}"
          >${personName}</a
        >
      `);
    } else if (p.url) {
      contents.push(html`
        <a class="u-url url p-name fn" href="${p.url}">${personName}</a>
      `);
    } else {
      contents.push(
        html`
          <span class="p-name fn">${personName}</span>
        `
      );
    }
    if (p.orcid) {
      contents.push(
        html`<a class="p-name orcid" href="${p.orcid}">${orcidSvg()}
         </a>`
      );
    }
    if (p.company) {
      if (p.companyURL) {
        contents.push(
          html`
            (<a class="p-org org h-org h-card" href="${p.companyURL}"
              >${company}</a
            >)
          `
        );
      } else {
        contents.push(
          html`
            (${company})
          `
        );
      }
    }
    if (p.note) contents.push(document.createTextNode(` (${p.note})`));
    if (p.extras) {
      const results = p.extras
        // Remove empty names
        .filter(extra => extra.name && extra.name.trim())
        // Convert to HTML
        .map(getExtra);
      for (const result of results) {
        contents.push(document.createTextNode(", "), result);
      }
    }
    if (p.retiredDate) {
      const retiredDate = new Date(p.retiredDate);
      const isValidDate = retiredDate.toString() !== "Invalid Date";
      const timeElem = document.createElement("time");
      timeElem.textContent = isValidDate
        ? humanDate(retiredDate)
        : "Invalid Date"; // todo: Localise invalid date
      if (!isValidDate) {
        showInlineError(
          timeElem,
          "The date is invalid. The expected format is YYYY-MM-DD.",
          "Invalid date"
        );
      }
      timeElem.dateTime = toShortIsoDate(retiredDate);
      contents.push(
        html`
          - ${l10n.until.concat(" ")}${timeElem}
        `
      );
    }

    // @ts-ignore: hyperhtml types only support Element but we use a DocumentFragment here
    html.bind(span)`${contents}`;
    dd.appendChild(span);
    return dd;
  }

  function getExtra(extra) {
    const span = html`
      <span class="${extra.class || null}"></span>
    `;
    let textContainer = span;
    if (extra.href) {
      textContainer = html`
        <a href="${extra.href}"></a>
      `;
      span.appendChild(textContainer);
    }
    textContainer.textContent = extra.name;
    return span;
  }
};
