// jsdom@30 未实现 Element.prototype.scrollIntoView。bits-ui Command 在选中首个
// item 时会经 afterTick 链调用它(registerItem → #selectFirstItem → setValue →
// #scrollSelectedIntoView),不 stub 会以 unhandled rejection(TypeError)形式抛错。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
