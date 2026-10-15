const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../src/answer-syntax.mjs');
const visible=html=>html.replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');

test('bare Java answers reuse the document highlighter and preserve every character',async()=>{
  const {answerSyntax}=await load();
  const {highlightCode}=await import('../src/editor-highlight.mjs');
  const code='import java.util.List;\n\npublic class Demo {\n    String text = "中文 <tag>";\n}\n';
  const result=answerSyntax(code);
  assert.equal(result.language,'java');assert.equal(result.code,true);
  assert.equal(result.html,highlightCode(code,'java').value);
  assert.equal(visible(result.html),code);
});
test('mixed prose, multiple code fences, incomplete fences and blank lines retain exact source',async()=>{
  const {answerSyntax}=await load();
  for(const code of ['解释如下：\n\n```java\n// 注释\n\nString s = "好";\n```\n再解释。\n\n~~~python\nprint(42)\n~~~', '```java\nimport java.util.List;\n\n', '````java\n```\npublic class Demo {}\n````\n', '<img src=x onerror=alert(1)>\n```unknown\n<tag>\n```']){
    const result=answerSyntax(code);assert.equal(visible(result.html),code);assert.equal(result.code,true);assert.ok(!result.html.includes('<img'));
  }
});
test('plain explanations stay plain; manual language and question hints support unfinished code',async()=>{
  const {answerSyntax}=await load();
  const context='用 Java 作答\n```java\nint count = 1;\n```';
  assert.equal(answerSyntax('函数式接口只有一个抽象方法。',{context}).code,false);
  assert.equal(answerSyntax('return 1;',{context}).language,'java');
  assert.match(answerSyntax('return 1',{language:'python'}).html,/hljs-keyword/);
  const code='```java\npublic class Demo {}\n```';
  assert.equal(answerSyntax(code,{language:'plaintext'}).html,code);
  assert.equal(answerSyntax(code,{language:'plaintext'}).code,false);
});
test('large answers remain intact and editable when highlighting falls back to plain text',async()=>{
  const {answerSyntax}=await load();
  const code='public class Demo {\n'+'// 一行注释\n'.repeat(4000)+'}\n';
  const result=answerSyntax(code);assert.equal(visible(result.html),code);
});
