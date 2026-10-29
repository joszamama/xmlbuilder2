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

  $$.test('returned node should be the top level node', () => {
    const baz = $$.create().ele('Qroot').ele($$.t`
      <Qfoo>
        <Qbar>foobar</Qbar>
      </Qfoo>
      <Qbaz/>
    `);

    $$.deepEqual(baz.toString(), '<Qbaz/>')
  })

  $$.test('internal entity references', () => {
    const doc = $$.create('<!DOCTYPE w [<!ENTITY e "v">]><w a="&e;">&e;</w>')
    $$.deepEqual(doc.root().node.textContent, 'v')
    $$.deepEqual(doc.end(), '<?xml version="1.0"?><!DOCTYPE w><w a="v">v</w>')
  })

  $$.test('internal entity declarations', () => {
    const xml = $$.t`
    <!DOCTYPE root SYSTEM "root.dtd" [
      <!-- <!ENTITY a "comment"> -->
      <?pi <!ENTITY a "pi">?>
      <!ATTLIST root att CDATA "<!ENTITY a 'attlist'>">
      <!ENTITY a "&#x41;&#66;">
      <!ENTITY a "second">
      <!ENTITY markup "<b/>">
      <!ENTITY ref "&a;">
      <!ENTITY % param "x">
      <!ENTITY ext SYSTEM "ext.xml">
    ]>
    <root>&a;|&markup;|&ref;|&ext;</root>
    `
    $$.deepEqual($$.create(xml).root().node.textContent, 'AB|&markup;|&ref;|&ext;')
  })

  $$.test('internal entity expansion limit', () => {
    const value = 'x'.repeat(100000)
    const xml = '<!DOCTYPE w [<!ENTITY e "' + value + '">]><w>' + '&e;'.repeat(100) + '</w>'
    $$.throws(() => $$.create(xml), /Entity expansion limit exceeded/)
  })

})
