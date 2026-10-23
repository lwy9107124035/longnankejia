"""Create a small, valid compressed DOCX for the opt-in import audit."""
import sys
import zipfile
from pathlib import Path

target = Path(sys.argv[1])
text = '这是一份正常的Word导入测试文档，正文包含客家蓝染的材料、工序和馆藏来源，长度足以生成知识草稿。'
files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p><w:p><w:r><w:t>来源 &amp; 考据</w:t><w:br/><w:t>换行后中文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内文字</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>',
}
target.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, xml in files.items():
        archive.writestr(name, xml)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert text in archive.read('word/document.xml').decode('utf-8')
