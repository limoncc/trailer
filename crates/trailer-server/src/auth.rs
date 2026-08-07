/// Auth system — users stored in DB; login uses in-memory session, API tokens stored in DB.
///
/// 登录 token 只存内存 session(不落库,重启失效,24h 过期),供前端会话认证。
/// API token(手动创建)持久化在 `api_tokens` 表,供 Python SDK 写数据鉴权。
/// 认证先查内存 session,未命中再查 api_tokens(兼容 SDK 持久 token)。
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 登录 session 有效期(秒):24 小时。
const SESSION_TTL: f64 = 24.0 * 3600.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    pub role: String,
}

pub type SharedAuth = Arc<Mutex<AuthState>>;

#[derive(Debug, Clone)]
pub struct SessionEntry {
    pub user_id: i64,
    pub expires_at: f64,
}

pub struct AuthState {
    pub store: Arc<dyn trailer_core::Storage>,
    pub sessions: Mutex<HashMap<String, SessionEntry>>,
}

/// 生成持久化 API token:`rt_` + 64 位随机 hex。
fn generate_token() -> String {
    format!("rt_{:x}{:x}", rand::random::<u64>(), rand::random::<u64>())
}

impl AuthState {
    pub async fn new(store: Arc<dyn trailer_core::Storage>) -> Self {
        // Ensure default admin exists
        let admin_exists = store
            .get_user_by_username("admin")
            .await
            .ok()
            .flatten()
            .is_some();
        if !admin_exists {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs_f64();
            let _ = store
                .insert_user(&trailer_core::domain::UserRow {
                    id: None,
                    username: "admin".into(),
                    password: hash_password("admin"),
                    role: "admin".into(),
                    created_at: now,
                    theme: "{}".into(),
                })
                .await;
        }
        // 一次性清理历史 login token(登录不再落库,移除旧的 name='login' 记录)
        let _ = store.delete_api_tokens_by_name("login").await;
        Self {
            store,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn now() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
    }

    /// 清理过期 session(登录/注册时调用,防无限增长)。
    async fn purge_expired_sessions(&self) {
        let now = Self::now();
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, s| s.expires_at > now);
    }

    /// 登录:验证密码 → 生成内存 session token(不落库,24h 过期)。
    pub async fn login(&self, username: &str, password: &str) -> Option<(String, UserInfo)> {
        let user = self
            .store
            .get_user_by_username(username)
            .await
            .ok()
            .flatten()?;
        if user.password != hash_password(password) {
            return None;
        }
        let uid = user.id.unwrap_or(0);
        let token = generate_token();
        self.purge_expired_sessions().await;
        self.sessions.lock().await.insert(
            token.clone(),
            SessionEntry {
                user_id: uid,
                expires_at: Self::now() + SESSION_TTL,
            },
        );
        Some((
            token,
            UserInfo {
                id: uid,
                username: user.username,
                role: user.role,
            },
        ))
    }

    /// 注册:创建用户 → 自动登录(返回内存 session token)。
    pub async fn register(
        &self,
        username: &str,
        password: &str,
    ) -> Result<(String, UserInfo), String> {
        let now = Self::now();
        let user = trailer_core::domain::UserRow {
            id: None,
            username: username.into(),
            password: hash_password(password),
            role: "experimenter".into(),
            created_at: now,
            theme: "{}".into(),
        };
        let id = self
            .store
            .insert_user(&user)
            .await
            .map_err(|e| format!("{}", e))?;
        let token = generate_token();
        self.purge_expired_sessions().await;
        self.sessions.lock().await.insert(
            token.clone(),
            SessionEntry {
                user_id: id,
                expires_at: now + SESSION_TTL,
            },
        );
        Ok((
            token,
            UserInfo {
                id,
                username: username.into(),
                role: "experimenter".into(),
            },
        ))
    }

    /// 按 token 查用户:先查内存 session(登录),未命中再查 api_tokens(SDK 持久 token)。
    pub async fn get_user_by_token(&self, token: &str) -> Option<UserInfo> {
        // 1) 内存 session(登录)
        let now = Self::now();
        let uid = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(token)
                .filter(|s| s.expires_at > now)
                .map(|s| s.user_id)
        };
        if let Some(uid) = uid {
            let user = self.store.get_user_by_id(uid).await.ok().flatten()?;
            return Some(UserInfo {
                id: uid,
                username: user.username,
                role: user.role,
            });
        }
        // 2) api_tokens 表(SDK 持久 token,含过期检查)
        let user = self
            .store
            .get_user_by_api_token(token)
            .await
            .ok()
            .flatten()?;
        Some(UserInfo {
            id: user.id.unwrap_or(0),
            username: user.username,
            role: user.role,
        })
    }

    pub async fn list_users(&self) -> Vec<UserInfo> {
        self.store
            .list_users(None, None)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|u| UserInfo {
                id: u.id.unwrap_or(0),
                username: u.username,
                role: u.role,
            })
            .collect()
    }

    pub async fn set_role(&self, id: i64, role: &str) -> bool {
        self.store.update_user_role(id, role).await.is_ok()
    }

    pub async fn remove_user(&self, id: i64) -> bool {
        self.store.delete_user(id).await.is_ok()
    }

    pub async fn set_password(&self, id: i64, new: &str) -> bool {
        let pw = hash_password(new);
        self.store.update_user_password(id, &pw).await.is_ok()
    }

    pub async fn change_password(&self, id: i64, old: &str, new: &str) -> bool {
        let user = self.store.get_user_by_id(id).await.ok().flatten();
        match user {
            Some(u) if u.password == hash_password(old) => self
                .store
                .update_user_password(id, &hash_password(new))
                .await
                .is_ok(),
            _ => false,
        }
    }
}

pub fn hash_password(pw: &str) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(pw.as_bytes());
    hex::encode(h)
}
