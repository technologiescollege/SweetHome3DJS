/**
 * Ambient typings for @flyskypie/xml-sax-parser (no published @types).
 * Subpath exports map to ./jssaxparser/* (see package "exports").
 */

declare module '@flyskypie/xml-sax-parser' {
  export class SAXParser {
    constructor(
      contentHandler?: unknown,
      lexicalHandler?: unknown,
      errorHandler?: unknown,
      declarationHandler?: unknown,
      dtdHandler?: unknown,
      entityResolver?: unknown,
      locator?: unknown,
      domNode?: unknown
    );
    parseString(xml: string): void;
    [key: string]: unknown;
  }
}

declare module '@flyskypie/xml-sax-parser/exceptions/index.js' {
  export class SAXException extends Error {
    constructor(message?: string, exception?: unknown);
    getMessage(): string | undefined;
    getException(): unknown;
  }

  export class SAXNotSupportedException extends SAXException {
    constructor(msg?: string);
  }

  export class SAXNotRecognizedException extends SAXException {
    constructor(msg?: string);
  }

  export class SAXParseException extends SAXException {
    constructor(msg?: string, locator?: unknown);
    getColumnNumber(): number | undefined;
    getLineNumber(): number | undefined;
    getPublicId(): string | null | undefined;
    getSystemId(): string | null | undefined;
  }
}

declare module '@flyskypie/xml-sax-parser/DefaultHandlers.js' {
  /** SAX Attributes (org.xml.sax.Attributes). */
  export interface Attributes {
    getLength(): number;
    getURI(index: number): string;
    getLocalName(index: number): string;
    getQName(index: number): string;
    getType(index: number): string;
    getType(qName: string): string;
    getType(uri: string, localName: string): string;
    getValue(index: number): string;
    getValue(qName: string): string;
    getValue(uri: string, localName: string): string;
    getIndex(qName: string): number;
    getIndex(uri: string, localName: string): number;
  }

  export class DefaultHandler {
    saxParseExceptions: unknown[];
    locator?: unknown;

    startDocument(): void;
    startElement(
      namespaceURI: string | null,
      localName: string | null,
      qName: string | null,
      atts: Attributes
    ): void;
    endElement(
      namespaceURI: string | null,
      localName: string | null,
      qName: string | null
    ): void;
    startPrefixMapping(prefix: string, uri: string): void;
    endPrefixMapping(prefix: string): void;
    processingInstruction(target: string, data: string): void;
    ignorableWhitespace(ch: string, start: number, length: number): void;
    /** JSweet / Java SAX passes a char array; JS ports sometimes use string. */
    characters(ch: string | string[], start: number, length: number): void;
    skippedEntity(name: string): void;
    endDocument(): void;
    setDocumentLocator(locator: unknown): void;
    resolveEntity(publicId: string | null, systemId: string | null): unknown;
    notationDecl(
      name: string,
      publicId: string | null,
      systemId: string | null
    ): void;
    unparsedEntityDecl(
      name: string,
      publicId: string | null,
      systemId: string | null,
      notationName: string
    ): void;
    warning(saxParseException: unknown): void;
    error(saxParseException: unknown): void;
    fatalError(saxParseException: unknown): void;
  }

  export class DefaultHandler2 extends DefaultHandler {}
}
