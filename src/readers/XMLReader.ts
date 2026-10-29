import { XMLStringLexer } from "@oozcitak/dom/lib/parser/XMLStringLexer"
import {
  TokenType, DeclarationToken, DocTypeToken, CDATAToken, CommentToken,
  TextToken, PIToken, ElementToken
} from "@oozcitak/dom/lib/parser/interfaces"
import { NodeType } from "@oozcitak/dom/lib/dom/interfaces"
import { namespace as infraNamespace } from "@oozcitak/infra"
import { namespace_extractQName } from "@oozcitak/dom/lib/algorithm"
import { XMLBuilder, XMLBuilderOptions } from "../interfaces"
import { BaseReader } from "./BaseReader"
import { decodeNumberedEntityRegex } from "../constants"

/**
 * Matches an internal general entity declaration: `<!ENTITY name "value">`.
 */
const entityDeclarationRegex = /^<!ENTITY\s+([^\s%"']+)\s+(?:"([^"]*)"|'([^']*)')\s*>$/
/**
 * Matches an entity reference: `&name;`.
 */
const entityReferenceRegex = /&([^#\s&;][^\s&;]*);/g
/**
 * Entity references may add at most this many characters to a document, or
 * five times the length of the document if that is more.
 */
const entityExpansionLimit = 1000000

/**
 * Parses XML nodes from an XML document string.
 */
export class XMLReader extends BaseReader<string> {

  private _entities = new Map<string, string | undefined>()
  private _entityExpansionLeft = 0

  /**
   * Parses the given document representation.
   * 
   * @param node - node receive parsed XML nodes
   * @param str - XML document string to parse
   */
  _parse(node: XMLBuilder, str: string): XMLBuilder {
    const lexer = new XMLStringLexer(str, { skipWhitespaceOnlyText: this._builderOptions.skipWhitespaceOnlyText })

    let lastChild = node
    let context = node

    let token = lexer.nextToken()
    while (token.type !== TokenType.EOF) {
      switch (token.type) {
        case TokenType.Declaration:
          const declaration = <DeclarationToken>token
          const version = this.sanitize(declaration.version)
          if (version !== "1.0") {
            throw new Error("Invalid xml version: " + version)
          }
          const builderOptions: Partial<XMLBuilderOptions> = {
            version: version
          }
          if (declaration.encoding) {
            builderOptions.encoding = this.sanitize(declaration.encoding)
          }
          if (declaration.standalone) {
            builderOptions.standalone = (this.sanitize(declaration.standalone) === "yes")
          }
          context.set(builderOptions)
          break
        case TokenType.DocType:
          const doctype = <DocTypeToken>token
          this._readInternalEntities(str)
          context = this.docType(context, this.sanitize(doctype.name), this.sanitize(doctype.pubId), this.sanitize(doctype.sysId)) || context
          break
        case TokenType.CDATA:
          const cdata = <CDATAToken>token
          context = this.cdata(context, this.sanitize(cdata.data)) || context
          break
        case TokenType.Comment:
          const comment = <CommentToken>token
          context = this.comment(context, this.sanitize(comment.data)) || context
          break
        case TokenType.PI:
          const pi = <PIToken>token
          context = this.instruction(context, this.sanitize(pi.target), this.sanitize(pi.data)) || context
          break
        case TokenType.Text:
          if(context.node.nodeType === NodeType.Document) break
          const text = <TextToken>token
          context = this.text(context, this._decodeText(this.sanitize(text.data))) || context
          break
        case TokenType.Element:
          const element = <ElementToken>token
          const elementName = this.sanitize(element.name)

          // inherit namespace from parent
          const [prefix] = namespace_extractQName(elementName)
          let namespace = context.node.lookupNamespaceURI(prefix)

          // override namespace if there is a namespace declaration
          // attribute
          // also lookup namespace declaration attributes
          const nsDeclarations: { [key: string]: string } = {}
          for (let [attName, attValue] of element.attributes) {
            attName = this.sanitize(attName)
            attValue = this.sanitize(attValue)
            if (attName === "xmlns") {
              namespace = attValue
            } else {
              const [attPrefix, attLocalName] = namespace_extractQName(attName)
              if (attPrefix === "xmlns") {
                if (attLocalName === prefix) {
                  namespace = attValue
                }
                nsDeclarations[attLocalName] = attValue
              }
            }
          }

          // create the DOM element node
          const elementNode = (namespace !== null ?
            this.element(context, namespace, elementName) :
            this.element(context, undefined, elementName))
          if (elementNode === undefined) break
          if (context.node === node.node) lastChild = elementNode

          // assign attributes
          for (let [attName, attValue] of element.attributes) {
            attName = this.sanitize(attName)
            attValue = this.sanitize(attValue)
            const [attPrefix, attLocalName] = namespace_extractQName(attName)
            let attNamespace: string | null = null
            if (attPrefix === "xmlns" || (attPrefix === null && attLocalName === "xmlns")) {
              // namespace declaration attribute
              attNamespace = infraNamespace.XMLNS
            } else {
              attNamespace = elementNode.node.lookupNamespaceURI(attPrefix)
              if (attNamespace !== null && elementNode.node.isDefaultNamespace(attNamespace)) {
                attNamespace = null
              } else if (attNamespace === null && attPrefix !== null) {
                attNamespace = nsDeclarations[attPrefix] || null
              }
            }

            if (attNamespace !== null)
              this.attribute(elementNode, attNamespace, attName, this._decodeAttributeValue(attValue))
            else
              this.attribute(elementNode, undefined, attName, this._decodeAttributeValue(attValue))
          }

          if (!element.selfClosing) {
            context = elementNode
          }
          break
        case TokenType.ClosingTag:
          /* istanbul ignore else */
          if (context.node.parentNode) {
            context = context.up()
          }
          break
      }

      token = lexer.nextToken()
    }

    return lastChild
  }

  /**
   * Decodes serialized text, including references to internal entities
   * declared in the document type declaration.
   *
   * @param text - text value to decode
   */
  _decodeText(text: string): string {
    if (text == null || this._entities.size === 0) return super._decodeText(text)

    return super._decodeText(text.replace(entityReferenceRegex, (match, name) => {
      const value = this._entities.get(name)
      if (value === undefined) return match
      this._entityExpansionLeft -= value.length
      if (this._entityExpansionLeft < 0) {
        throw new Error("Entity expansion limit exceeded.")
      }
      return value
    }))
  }

  /**
   * Reads the internal general entities declared in the internal subset of the
   * document type declaration. An entity whose replacement text contains
   * markup or other references is not expanded.
   *
   * @param str - XML document string
   */
  private _readInternalEntities(str: string): void {
    this._entityExpansionLeft = Math.max(entityExpansionLimit, 5 * str.length)

    // find the document type declaration
    let i = 0
    while (i < str.length && !str.startsWith("<!DOCTYPE", i)) {
      if (str.startsWith("<?", i)) {
        i = skipPast(str, i + 2, "?>")
      } else if (str.startsWith("<!--", i)) {
        i = skipPast(str, i + 4, "-->")
      } else {
        i++
      }
    }

    // skip the name and external ID
    i = indexOfUnquoted(str, i + 9, "[>")
    if (str[i] !== "[") return

    // read markup declarations up to the end of the internal subset
    i++
    while (i < str.length && str[i] !== "]") {
      if (str.startsWith("<!--", i)) {
        i = skipPast(str, i + 4, "-->")
      } else if (str.startsWith("<?", i)) {
        i = skipPast(str, i + 2, "?>")
      } else if (str.startsWith("<!", i)) {
        const end = indexOfUnquoted(str, i + 2, ">") + 1
        const match = str.slice(i, end).match(entityDeclarationRegex)
        i = end
        // the first declaration of an entity is binding
        if (match === null || this._entities.has(match[1])) continue
        // character references are replaced when the entity is declared
        const literal = match[2] ?? match[3]
        const value = literal.replace(decodeNumberedEntityRegex, (_match, hexStr, numStr) =>
          String.fromCodePoint(parseInt(hexStr || numStr, hexStr ? 16 : 10))
        )
        this._entities.set(match[1],
          literal.includes("%") || /[<&]/.test(value) ? undefined : this.sanitize(value))
      } else {
        i++
      }
    }
  }
}

/**
 * Returns the index after the next occurrence of `end`, or the length of the
 * string if there is none.
 *
 * @param str - string to search
 * @param i - index to start from
 * @param end - string to find
 */
function skipPast(str: string, i: number, end: string): number {
  const index = str.indexOf(end, i)
  return index === -1 ? str.length : index + end.length
}

/**
 * Returns the index of the next character that is one of `chars` and not
 * inside a quoted literal, or the length of the string if there is none.
 *
 * @param str - string to search
 * @param i - index to start from
 * @param chars - characters to find
 */
function indexOfUnquoted(str: string, i: number, chars: string): number {
  while (i < str.length && !chars.includes(str[i])) {
    i = (str[i] === "\"" || str[i] === "'") ? skipPast(str, i + 1, str[i]) : i + 1
  }
  return i
}
