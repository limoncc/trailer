/** 分享链接只读视图判定:URL 带 ?token=(服务端写接口对匿名 share token 一律 401,
 *  UI 层据此隐藏编辑布局/添加图表/Resume 等写入口,并跳过会失败的自动保存)。 */
export function isShareView(): boolean {
  if (typeof window === 'undefined') return false;
  const token = new URLSearchParams(window.location.search).get('token');
  return typeof token === 'string' && token.length > 0;
}
