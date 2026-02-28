use axum::routing::{get, post};
use clap::Parser;
use color_eyre::eyre::{eyre, Result};
use rbx_studio_server::*;
use std::io;
use std::net::Ipv4Addr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber::{self, EnvFilter};

mod error;
mod install;
mod rbx_studio_server;

#[derive(Parser)]
#[command(version, about = "Gemini-powered agent for Roblox Studio")]
struct Args {
    #[arg(long)]
    install: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    color_eyre::install()?;
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(io::stderr)
        .with_target(false)
        .with_thread_ids(true)
        .init();

    let args = Args::parse();
    if args.install {
        return install::install().await;
    }

    let api_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| eyre!("GEMINI_API_KEY environment variable is not set. Please set it before running."))?;

    let server_state = Arc::new(Mutex::new(AppState::new()));

    let (close_tx, close_rx) = tokio::sync::oneshot::channel();

    let listener =
        tokio::net::TcpListener::bind((Ipv4Addr::new(127, 0, 0, 1), STUDIO_PLUGIN_PORT)).await;

    let server_state_clone = Arc::clone(&server_state);
    let server_handle = if let Ok(listener) = listener {
        let app = axum::Router::new()
            .route("/request", get(request_handler))
            .route("/response", post(response_handler))
            .route("/proxy", post(proxy_handler))
            .with_state(server_state_clone);
        tracing::info!("HTTP server listening on port {STUDIO_PLUGIN_PORT} for Roblox Studio plugin");
        tokio::spawn(async {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    _ = close_rx.await;
                })
                .await
                .unwrap();
        })
    } else {
        tracing::info!("Port busy, using proxy mode");
        tokio::spawn(async move {
            dud_proxy_loop(server_state_clone, close_rx).await;
        })
    };

    let chat_result = run_chat_loop(Arc::clone(&server_state), api_key).await;

    if let Err(e) = &chat_result {
        tracing::error!("Chat loop error: {:?}", e);
    }

    close_tx.send(()).ok();
    tracing::info!("Waiting for HTTP server to gracefully shutdown");
    server_handle.await.ok();
    tracing::info!("Bye!");

    chat_result
}
