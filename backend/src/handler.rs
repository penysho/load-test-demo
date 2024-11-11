use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    db::DbPool,
    models::{NewPost, Post},
};

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

    let results = posts
        .filter(id.eq(path_id))
        .select(Post::as_select())
        .load(&mut conn)
        .expect("Error loading posts");

    if results.len() == 0 {
        return Err((StatusCode::NOT_FOUND, "Post not found".to_string()));
    }

    Ok(Json(
        results
            .into_iter()
            .map(|row| PostDTO {
                id: row.id,
                title: row.title,
                body: row.body,
                published: row.published,
            })
            .collect(),
    ))
}

pub async fn get_posts(
    State(pool): State<DbPool>,
) -> Result<Json<Vec<PostDTO>>, (StatusCode, String)> {
    use crate::schema::posts::dsl::*;

    let mut conn = pool.get().map_err(internal_error)?;

    let results = posts
        .select(Post::as_select())
        .load(&mut conn)
        .expect("Error loading posts");

    Ok(Json(
        results
            .into_iter()
            .map(|row| PostDTO {
                id: row.id,
                title: row.title,
                body: row.body,
                published: row.published,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct PostRequest {
    pub title: String,
    pub body: String,
}

pub async fn create_post(
    State(pool): State<DbPool>,
    Json(request): Json<PostRequest>,
) -> Result<Json<PostDTO>, (StatusCode, String)> {
    use crate::schema::posts;

    let mut conn = pool.get().map_err(internal_error)?;

    let new_post = NewPost {
        title: &request.title,
        body: &request.body,
    };

    let post = diesel::insert_into(posts::table)
        .values(&new_post)
        .returning(Post::as_returning())
        .get_result(&mut conn)
        .expect("Error saving new post");

    Ok(Json(PostDTO {
        id: post.id,
        title: post.title,
        body: post.body,
        published: post.published,
    }))
}

fn internal_error<E>(err: E) -> (StatusCode, String)
where
    E: std::error::Error,
{
    (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
}
