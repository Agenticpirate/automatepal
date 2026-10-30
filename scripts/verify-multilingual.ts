import assert from'node:assert/strict';
import{detectQuestionLanguage,languageFallback,languageDirective}from'../lib/knowledge';
function ok(n:string){console.log('PASS',n);}
// Script-based detection
assert.equal(detectQuestionLanguage('\u0915\u094D\u092F\u093E \u0906\u092A \u092A\u0941\u0923\u0947 \u092E\u0947\u0902 \u0921\u093F\u0932\u0940\u0935\u0930 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902?')?.code,'hi');
assert.equal(detectQuestionLanguage('\u0C2E\u0C40\u0C30\u0C41 \u0C2A\u0C41\u0C23\u0C47\u0C15\u0C3F \u0C21\u0C46\u0C32\u0C3F\u0C35\u0C30\u0C40 \u0C1A\u0C47\u0C38\u0C4D\u0C24\u0C3E\u0C30\u0C3E?')?.code,'te');
assert.equal(detectQuestionLanguage('\u0BA8\u0BC0\u0B99\u0BCD\u0B95\u0BB3\u0BCD \u0BAA\u0BC1\u0BA9\u0BC7\u0B95\u0BCD\u0B95\u0BC1 \u0B9A\u0BC6\u0BB2\u0BCD\u0BB5\u0BC0\u0BB0\u0BCD\u0B95\u0BB3\u0BBE?')?.code,'ta');
assert.equal(detectQuestionLanguage('\u0647\u0644 \u062A\u0648\u0635\u0644\u0648\u0646 \u0625\u0644\u0649 \u0627\u0644\u0631\u064A\u0627\u0636?')?.code,'ar');
assert.equal(detectQuestionLanguage('\u3053\u3093\u306B\u3061\u306F\u3001\u914D\u9001\u3067\u304D\u307E\u3059\u304B')?.code,'ja');
assert.equal(detectQuestionLanguage('\uC9C0\uAE08 \uBC30\uC1A1 \uAC00\uB2A5\uD55C\uAC00\uC694?')?.code,'ko');
assert.equal(detectQuestionLanguage('\u4F60\u4EEC\u9001\u8D27\u5230\u5317\u4EAC\u5417')?.code,'zh');
assert.equal(detectQuestionLanguage('\u0414\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442\u0435 \u043B\u0438 \u0432\u044B \u0432 \u041C\u043E\u0441\u043A\u0432\u0443?')?.code,'ru');
ok('script detection: hi te ta ar ja ko zh ru');
// Latin-script detection via stopwords
assert.equal(detectQuestionLanguage('\u00BFCu\u00E1nto cuesta el env\u00EDo y cu\u00E1ndo llega mi pedido?')?.code,'es');
assert.equal(detectQuestionLanguage('Comment puis je suivre ma commande et quels sont les d\u00E9lais de livraison?')?.code,'fr');
assert.equal(detectQuestionLanguage('Wie kann ich meine Bestellung verfolgen und wie lange dauert der Versand?')?.code,'de');
assert.equal(detectQuestionLanguage('Como posso rastrear minha pedido e quando chega a entrega?')?.code,'pt');
ok('latin detection: es fr de pt');
// English and ambiguous stay null
assert.equal(detectQuestionLanguage('Do you ship to Pune and how long does delivery take?'),null);
assert.equal(detectQuestionLanguage('refund?'),null);
assert.equal(detectQuestionLanguage(''),null);
ok('english / short / empty questions return null');
// Directive wording
assert.ok(languageDirective({code:'es',name:'Spanish'}).includes('Write the whole answer in Spanish'));
assert.ok(languageDirective({code:'es',name:'Spanish'}).includes('Keep evidence quotes verbatim'));
assert.equal(languageDirective(null),'Answer in the language of the question.');
ok('languageDirective names the language and keeps quotes verbatim');
// Localized fallbacks, honest content
for(const code of['hi','te','ta','es','fr','de','pt']){const f=languageFallback({code,name:code});assert.ok(f.length>30&&!f.startsWith('I do not'),code);}
assert.ok(languageFallback({code:'hi',name:'Hindi'}).includes('\u092A\u094D\u0930\u0915\u093E\u0936\u093F\u0924'));
assert.ok(languageFallback({code:'te',name:'Telugu'}).includes('\u0C2A\u0C4D\u0C30\u0C1A\u0C41\u0C30\u0C3F\u0C24'));
assert.equal(languageFallback(null),'I do not have enough published information to answer that. Please ask a person to review.');
assert.equal(languageFallback({code:'ar',name:'Arabic'}),languageFallback(null));// no Arabic fallback yet: honest English default
ok('localized fallbacks for 7 languages, honest default otherwise');
console.log('all multilingual checks passed');
