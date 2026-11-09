use crate::state::err;
use tokio::sync::Semaphore;

// Bound blocking work without making the UI or async executor wait on locks.
static OPERATIONS: Semaphore = Semaphore::const_new(4);
static MUTATIONS: Semaphore = Semaphore::const_new(1);

pub(crate) async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = OPERATIONS.acquire().await.map_err(err)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(err)?
}

// Settings changes and destructive database operations must not interleave.
pub(crate) async fn write<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let permit = MUTATIONS.acquire().await.map_err(err)?;
    run(move || {
        let _permit = permit;
        work()
    })
    .await
}
