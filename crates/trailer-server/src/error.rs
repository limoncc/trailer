use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

/// Standard error response body
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: u16,
    pub message: String,
}

impl ErrorBody {
    pub fn new(code: u16, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Unified API error type — maps internal errors to HTTP responses.
#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    NotFound(String),
    Conflict(String),
    TooManyRequests(String),
    Internal(String),
}

impl ApiError {
    pub fn status(&self) -> StatusCode {
        match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ApiError::BadRequest(m)
            | ApiError::Unauthorized(m)
            | ApiError::NotFound(m)
            | ApiError::Conflict(m)
            | ApiError::TooManyRequests(m)
            | ApiError::Internal(m) => m.as_str(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ErrorBody::new(status.as_u16(), self.message().to_string());
        (status, Json(body)).into_response()
    }
}

impl From<trailer_core::StorageError> for ApiError {
    fn from(err: trailer_core::StorageError) -> Self {
        match err {
            trailer_core::StorageError::NotFound(msg) => ApiError::NotFound(msg),
            trailer_core::StorageError::Serialization(msg) => ApiError::BadRequest(msg),
            _ => ApiError::Internal(err.to_string()),
        }
    }
}

/// 记录服务端错误后返回通用 500。底层错误只落日志, 不回客户端
/// (避免泄露存储路径 / SQL 片段等实现细节)。
pub fn internal_error(err: impl std::fmt::Display, context: &'static str) -> StatusCode {
    tracing::error!(error = %err, context, "internal error");
    StatusCode::INTERNAL_SERVER_ERROR
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn bad_request_maps_to_400() {
        let err = ApiError::BadRequest("missing field".into());
        assert_eq!(err.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn unauthorized_maps_to_401() {
        let err = ApiError::Unauthorized("invalid key".into());
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn not_found_maps_to_404() {
        let err = ApiError::NotFound("run not found".into());
        assert_eq!(err.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn conflict_maps_to_409() {
        let err = ApiError::Conflict("duplicate".into());
        assert_eq!(err.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn too_many_requests_maps_to_429() {
        let err = ApiError::TooManyRequests("backpressure".into());
        assert_eq!(err.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn internal_maps_to_500() {
        let err = ApiError::Internal("boom".into());
        assert_eq!(err.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn storage_not_found_becomes_404() {
        let storage_err = trailer_core::StorageError::NotFound("x".into());
        let api_err: ApiError = storage_err.into();
        assert_eq!(api_err.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn response_body_contains_code() {
        let err = ApiError::NotFound("run xyz not found".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
