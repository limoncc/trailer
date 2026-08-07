//! 编译时嵌入前端静态资源(需 feature `embed-frontend`)。
//! 构建前须先执行 `cd trailer-ui && pnpm build` 生成 `trailer-ui/build`。

use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use rust_embed::RustEmbed;

/// 嵌入的前端资源(`$CARGO_MANIFEST_DIR` = 本 crate 目录,相对它向上两级到仓库根的 `trailer-ui/build`)。
#[derive(RustEmbed)]
#[folder = "$CARGO_MANIFEST_DIR/../../trailer-ui/build"]
pub struct Asset;

/// 从嵌入资源提供前端静态文件;未知路径 SPA fallback 到 `index.html`。
pub fn serve(path: &str) -> Response {
    let rel = path.trim_start_matches('/');
    let key = if rel.is_empty() { "index.html" } else { rel };
    match Asset::get(key) {
        Some(file) => {
            let mime = mime_guess::from_path(key).first_or_octet_stream();
            (StatusCode::OK, [(header::CONTENT_TYPE, mime.as_ref())], file.data).into_response()
        }
        None => match Asset::get("index.html") {
            Some(index) => (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/html")],
                index.data,
            )
                .into_response(),
            None => StatusCode::NOT_FOUND.into_response(),
        },
    }
}
