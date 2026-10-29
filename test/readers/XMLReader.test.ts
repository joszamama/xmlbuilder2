import $$ from '../TestHelpers'

$$.suite('XMLReader', () => {

  $$.test('invalid version', () => {
    const xml = $$.t`
    <?xml version="1.1"?>
    <root/>
    `

    $$.throws(() => $$.create(xml))
  })

  $$.test('docType', () => {
    const xml = $$.t`
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <!DOCTYPE root PUBLIC "pub" "sys">
    <root>
      <ele>simple element</ele>
      <person age="35">
        <name>John</name>
        <?pi val?>
        <?pi?>
        <!--Good guy-->
        <![CDATA[well formed!]]>
        <address>
          <city>Istanbul</city>
          <street>End of long and winding road</street>
        </address>
        <contact>
          <phone>555-1234</phone>
          <phone>555-1235</phone>
        </contact>
        <id>42</id>
        <details>classified</details>
      </person>
    </root>
    `

    const result = $$.create(xml).end({ prettyPrint: true })
    $$.deepEqual(result, xml)
  })

  $$.test('prefixed attribute bound to the default namespace', () => {
    const doc = $$.create('<root xmlns:p="uri:myns" xmlns="uri:myns"><node p:att="val" att2="val2"/></root>')
    const node = doc.root().node.firstChild as any
    const att = node.attributes[0]
    $$.deepEqual([att.prefix, att.localName, att.namespaceURI], ['p', 'att', 'uri:myns'])
    const att2 = node.attributes[1]
    $$.deepEqual([att2.prefix, att2.localName, att2.namespaceURI], [null, 'att2', null])
    $$.deepEqual(doc.end(), '<?xml version="1.0"?><root xmlns:p="uri:myns" xmlns="uri:myns"><node p:att="val" att2="val2"/></root>')
  })

  $$.test('returned node should be the top level node', () => {
    const baz = $$.create().ele('Qroot').ele($$.t`
      <Qfoo>
        <Qbar>foobar</Qbar>
      </Qfoo>
      <Qbaz/>
    `);

    $$.deepEqual(baz.toString(), '<Qbaz/>')
  })

})
