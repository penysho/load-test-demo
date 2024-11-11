mod db;
mod handler;
mod models;
mod schema;

use std::env;

use axum::{routing::get, Router};

#[tokio::main]
async fn main() {
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

    let pool = db::get_connection_pool(database_url);

    let app = Router::new()
        .route("/posts/:id", get(handler::get_post))
        .route("/posts", get(handler::get_posts).post(handler::create_post))
        .route("/health", get(handler::health))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8011").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}
