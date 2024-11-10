use axum::{extract::Path, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;

#[tokio::main]
async fn main() {
    let app = configure_routes().await;

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8011").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

async fn configure_routes() -> Router {
    Router::new()
        .route("/posts/:id", get(get_post))
        .route("/health", get(health))
}

async fn health() -> impl IntoResponse {
    Json("ok")
}

#[derive(Debug, Serialize)]
pub struct Post {
    id: String,
    title: String,
    body: String,
}

async fn get_post(Path(id): Path<String>) -> impl IntoResponse {
    let mock_post = Post {
        id,
        title: "Hello World".to_string(),
        body: "This is a test post".to_string(),
    };

    Json(mock_post)
}
