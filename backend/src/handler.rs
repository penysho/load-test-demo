use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{db::DbPool, models::Post};

pub async fn health() -> impl IntoResponse {
    Json("ok")
}

#[derive(Deserialize, Serialize)]
pub struct PostDTO {
    pub id: i32,
    pub title: String,
    pub body: String,
    pub published: bool,
}

pub async fn get_post(
    State(pool): State<DbPool>,
    Path(path_id): Path<i32>,
) -> Result<Json<Vec<PostDTO>>, (StatusCode, String)> {
    use crate::schema::posts::dsl::*;

    let mut conn = pool.get().map_err(internal_error)?;
    let mut response = vec![];

    let results = posts
        .filter(id.eq(path_id))
        .select(Post::as_select())
        .load(&mut conn)
        .expect("Error loading posts");

    for row in results {
        response.push(PostDTO {
            id: row.id,
            title: row.title,
            body: row.body,
            published: row.published,
        });
    }

    Ok(Json(response))
}

pub async fn get_posts(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<PostDTO>>, (StatusCode, String)> {
    use crate::schema::posts::dsl::*;

    let mut conn = pool.get().map_err(internal_error)?;
    let mut response = vec![];

    let results = posts
        .select(Post::as_select())
        .load(&mut conn)
        .expect("Error loading posts");

    for row in results {
        response.push(PostDTO {
            id: row.id,
            title: row.title,
            body: row.body,
            published: row.published,
        });
    }

    Ok(Json(response))
}

fn internal_error<E>(err: E) -> (StatusCode, String)
where
    E: std::error::Error,
{
    (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
}
