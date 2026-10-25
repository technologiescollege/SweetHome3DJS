/**
 * Corrige des constructeurs ESM stricts cassés dans @flyskypie/xml-sax-parser
 * (super() manquant). Appelé en postinstall.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "node_modules", "@flyskypie", "xml-sax-parser", "jssaxparser");

const patches = [
  {
    file: join(base, "Reader.js"),
    from: "export class StringReader extends Reader {\n    constructor(s) { // String\n        this.s = s;",
    to: "export class StringReader extends Reader {\n    constructor(s) { // String\n        super();\n        this.s = s;",
    check: "constructor(s) { // String\n        super();",
  },
  {
    file: join(base, "XMLFilterImpls.js"),
    from: "return XMLFilterImpl.call(this, parent);",
    to: "super(parent);",
    check: "super(parent);",
  },
  {
    file: join(base, "SAXScanner.js"),
    from: "class InternalEntityNotFoundException extends SAXParseException {\n    constructor(entityName) {\n        this.entityName = entityName;\n    }",
    to: "class InternalEntityNotFoundException extends SAXParseException {\n    constructor(entityName) {\n        super(entityName);\n        this.entityName = entityName;\n    }",
    check: "class InternalEntityNotFoundException extends SAXParseException {\n    constructor(entityName) {\n        super(entityName);",
  },
  {
    file: join(base, "exceptions", "index.js"),
    from: "export class SAXNotSupportedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        this.message = msg || '';\n    }\n}",
    to: "export class SAXNotSupportedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        super(msg || '');\n        this.message = msg || '';\n    }\n}",
    check: "export class SAXNotSupportedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        super(msg || '');",
  },
  {
    file: join(base, "exceptions", "index.js"),
    from: "export class SAXNotRecognizedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        this.message = msg || '';\n    }\n}",
    to: "export class SAXNotRecognizedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        super(msg || '');\n        this.message = msg || '';\n    }\n}",
    check: "export class SAXNotRecognizedException extends SAXException {\n    constructor(msg) { // java.lang.Exception\n        super(msg || '');",
  },
  {
    file: join(base, "exceptions", "index.js"),
    from: "export class SAXParseException extends SAXException {\n    constructor(msg, locator) { // java.lang.Exception //\n        this.message = msg || '';\n        this.locator = locator;\n    }",
    to: "export class SAXParseException extends SAXException {\n    constructor(msg, locator) { // java.lang.Exception //\n        super(msg || '');\n        this.message = msg || '';\n        this.locator = locator;\n    }",
    check: "export class SAXParseException extends SAXException {\n    constructor(msg, locator) { // java.lang.Exception //\n        super(msg || '');",
  },
  {
    file: join(base, "LocatorImpls.js"),
    from: "export class Locator2Impl extends LocatorImpl {\n    constructor(locator) {\n        if (locator) {\n            super(locator); // 'columnNumber', 'lineNumber', 'publicId', 'systemId'\n            let properties = ['encoding', 'version'];\n            for (let i = 0; i < properties.length; i++) {\n                this[properties[i]] = locator[properties[i]];\n            }\n        }\n    }",
    to: "export class Locator2Impl extends LocatorImpl {\n    constructor(locator) {\n        super(locator); // 'columnNumber', 'lineNumber', 'publicId', 'systemId'\n        if (locator) {\n            let properties = ['encoding', 'version'];\n            for (let i = 0; i < properties.length; i++) {\n                this[properties[i]] = locator[properties[i]];\n            }\n        }\n    }",
    check: "export class Locator2Impl extends LocatorImpl {\n    constructor(locator) {\n        super(locator);",
  },
];

function applyOne({ file, from, to, check }) {
  if (!existsSync(file)) {
    console.warn(`patch-xml-sax-parser: introuvable ${file}`);
    return;
  }
  let src = readFileSync(file, "utf8");
  const norm = (s) => s.replace(/\r\n/g, "\n");
  const srcN = norm(src);
  if (srcN.includes(norm(check))) {
    console.log(`patch-xml-sax-parser: déjà OK — ${file}`);
    return;
  }
  if (!srcN.includes(norm(from))) {
    console.warn(`patch-xml-sax-parser: motif non trouvé — ${file}`);
    return;
  }
  const out = srcN.replace(norm(from), norm(to));
  writeFileSync(file, src.includes("\r\n") ? out.replace(/\n/g, "\r\n") : out);
  console.log(`patch-xml-sax-parser: patché — ${file}`);
}

for (const p of patches) applyOne(p);
