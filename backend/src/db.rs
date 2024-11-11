use diesel::{
    r2d2::{ConnectionManager, Pool},
    PgConnection,
};

pub type DbPool = Pool<ConnectionManager<PgConnection>>;

pub fn get_connection_pool(url: String) -> Pool<ConnectionManager<PgConnection>> {
    let manager = ConnectionManager::<PgConnection>::new(url);
    // Refer to the `r2d2` documentation for more methods to use
    // when building a connection pool
    Pool::builder()
        .test_on_check_out(true)
        .build(manager)
        .expect("Could not build connection pool")
}
