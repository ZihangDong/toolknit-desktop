use super::office;
use super::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    system_cleanup::await_previous_instance_for_elevated_relaunch();
    let mut context = tauri::generate_context!();
    if is_autostart_launch(std::env::args()) {
        for window in &mut context.config_mut().app.windows {
            if window.label == "main" {
                window.visible = false;
            }
        }
    }
    tauri::Builder::default()
        .on_page_load(|_webview, _payload| {
            #[cfg(feature = "qa-devtools")]
            if _payload.event() == tauri::webview::PageLoadEvent::Finished {
                crate::platform::qa_devtools::install(&_webview);
            }
        })
        .manage(WindowCornerRadiusState::default())
        .manage(AutostartState::default())
        .manage(quick_screenshot::ScreenshotState::default())
        .manage(local_translation::TranslationState::default())
        .manage(crate::clipboard_history::ClipboardHistoryState::default())
        .manage(onnx_segmenter::MattingState::default())
        .manage(TeleprompterRecognitionState::default())
        .invoke_handler(tauri::generate_handler![
            quick_screenshot::quick_screenshot,
            local_translation::local_translation,
            crate::clipboard_history::clipboard_history,
            crate::clipboard_history::copy_sensitive_text,
            open_url,
            ai_provider::request_private_ai_completion,
            ai_provider::cancel_private_ai_completion,
            store_ai_api_key,
            load_ai_api_key,
            clear_ai_api_key,
            set_window_corner_radius,
            hide_main_window,
            get_documents_dir,
            get_download_dir,
            get_install_lang,
            get_install_config,
            get_output_root,
            get_default_output_root,
            set_output_root,
            list_custom_fonts,
            import_custom_font,
            reset_custom_font,
            import_custom_background,
            clear_custom_background,
            log_custom_background_event,
            get_custom_background_media_url,
            check_transcription_engine,
            start_teleprompter_recognition,
            transcribe_teleprompter_audio,
            stop_teleprompter_recognition,
            onnx_segmenter::list_matting_models,
            onnx_segmenter::set_current_matting_model,
            onnx_segmenter::download_matting_model,
            onnx_segmenter::cancel_matting_model_download,
            onnx_segmenter::delete_matting_model,
            onnx_segmenter::segment_image,
            onnx_segmenter::cancel_matting_segmentation,
            onnx_segmenter::discard_matting_preview,
            onnx_segmenter::export_segmented_image,
            list_transcription_models,
            set_current_transcription_model,
            delete_transcription_model,
            download_transcription_model,
            transcribe_media,
            convert_audio_batch,
            cancel_convert,
            cancel_video_preview,
            office::open_path,
            office::open_recycle_bin,
            office::reveal_in_folder,
            read_file_bytes,
            read_file_bytes_limited,
            prepare_icon_source_image,
            write_file_bytes,
            write_unique_file_bytes,
            write_unique_file_pair,
            export_markdown_bundle,
            write_file_chunk,
            begin_icon_archive_write,
            append_icon_archive_chunk,
            finalize_icon_archive_write,
            discard_icon_archive_write,
            begin_pdf_enhance_write,
            append_pdf_enhance_chunk,
            finalize_pdf_enhance_write,
            discard_pdf_enhance_write,
            exists_path,
            get_file_size,
            get_hardware_overview,
            get_cpu_memory_info,
            get_cpu_memory_live_stats,
            get_gpu_display_info,
            get_mainboard_firmware_info,
            get_storage_health_info,
            get_network_devices_info,
            get_power_sensors_info,
            scan_large_files,
            system_runtime::duplicate_files::scan_duplicate_files,
            system_runtime::duplicate_files::cancel_duplicate_file_scan,
            system_runtime::duplicate_files::get_duplicate_file_progress,
            system_runtime::duplicate_files::recycle_duplicate_files,
            cancel_large_file_scan,
            get_cleanup_drive_space,
            move_files_to_recycle_bin,
            encrypt_pdf,
            decrypt_pdf,
            compress_pdf,
            begin_pdf_compress_write,
            append_pdf_compress_chunk,
            finalize_pdf_compress_write,
            discard_pdf_compress_write,
            begin_pdf_to_word_write,
            append_pdf_to_word_chunk,
            finalize_pdf_to_word_write,
            discard_pdf_to_word_write,
            open_pdf_to_word_result,
            trim_audio,
            probe_video,
            render_video_preview_frame,
            render_video_preview_clip,
            extract_audio,
            extract_video_frame,
            extract_video_gif,
            check_ffmpeg,
            get_ffmpeg_runtime_status,
            download_ffmpeg_runtime,
            delete_ffmpeg_runtime,
            get_libreoffice_runtime_status,
            is_libreoffice_runtime_available,
            download_libreoffice_runtime,
            delete_libreoffice_runtime,
            cancel_dependency_downloads,
            convert_image_batch,
            compress_image_batch,
            crop_image,
            export_replaced_image,
            hash_file,
            cancel_tool_operation,
            encrypt_tkaes_file,
            decrypt_tkaes_file,
            rsa_legacy_windows::rsa_legacy_operation,
            inspect_image_stitch_inputs,
            create_image_stitch_pdf_session,
            write_image_stitch_pdf_page,
            discard_image_stitch_pdf_session,
            stitch_images,
            create_pdf_to_image_session,
            read_pdf_to_image_source,
            write_pdf_to_image_page,
            write_pdf_to_image_page_json,
            discard_pdf_to_image_session,
            cancel_pdf_to_image,
            export_pdf_to_images,
            office::convert_ppt_to_pdf,
            office::discard_ppt_to_image_preview,
            office::convert_excel_to_pdf,
            convert_video_batch,
            set_tray_lang,
            get_autostart,
            set_autostart,
            screen_picker_bounds,
            screen_color_sample,
            open_screen_color_picker,
            close_screen_color_picker,
            get_screen_picker_shortcut,
            set_screen_picker_shortcut,
            system_cleanup::system_cleanup_is_admin,
            system_cleanup::system_cleanup_relaunch_as_admin,
            system_cleanup::system_cleanup_scan,
            system_cleanup::system_cleanup_run,
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|_webview, url| allow_webview_navigation(url))
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if !is_autostart_launch(argv) {
                show_main_window(app);
            }
        }))
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                )
            {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label())
                {
                    schedule_native_window_corner_radius_reapply(webview_window);
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    // The main window intentionally follows the conventional
                    // close-to-tray behavior used by ToolKnit.
                    "main" => {
                        api.prevent_close();
                        if platform::window_visibility::hide_on_main_thread(window).is_err() {
                            log::warn!("Unable to hide main window after system close request");
                        }
                    }
                    // The picker minimizes the main window while it is active.
                    // A system close request (Alt+F4, taskbar command, etc.)
                    // must restore the application instead of leaving both
                    // windows hidden.
                    "color-picker-overlay" => {
                        api.prevent_close();
                        let _ = window.hide();
                        show_main_window(window.app_handle());
                    }
                    // Do not globally suppress close behavior for future
                    // auxiliary windows. They should retain their own normal
                    // lifecycle unless they opt into one explicitly.
                    _ => {}
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                quick_screenshot::closed(window.app_handle(), window.label());
            }
        })
        .setup(|app| {
            cleanup_image_stitch_pdf_sessions();
            cleanup_pdf_to_image_sessions();
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // 系统托盘
            let lang = read_initial_lang();
            let menu = build_tray_menu(app.handle(), &lang)?;

            let _tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    "clipboard-toggle" => crate::clipboard_history::tray_toggle(app),
                    "autostart-toggle" => toggle_autostart_tray(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            show_main_window(tray.app_handle());
                        }
                    }
                })
                .build(app)?;

            crate::clipboard_history::bootstrap(app.handle());

            // 同步置顶状态到托盘菜单（可选）
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                if app
                    .config()
                    .app
                    .windows
                    .iter()
                    .any(|config| config.label == "main" && config.devtools == Some(true))
                {
                    window.open_devtools();
                }
                if let Err(error) = fit_main_window_to_work_area(&window) {
                    log::warn!("Unable to fit main window to monitor work area: {error}");
                }
                let _ = window.set_always_on_top(false);
                if is_autostart_launch(std::env::args()) {
                    let _ = window.hide();
                }
            }

            // 注册屏幕取色全局快捷键（如果用户已配置）。
            let shortcut_config = load_screen_picker_shortcut_config();
            if let Some(shortcut) = shortcut_config.shortcut.as_deref() {
                if !shortcut.trim().is_empty() {
                    let _ = register_screen_picker_shortcut(app.handle(), shortcut);
                }
            }

            quick_screenshot::initialize(app.handle());
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                local_translation::shutdown(app);
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                crate::clipboard_history::on_exit_requested(app, &api, code);
            }
        });
}

pub(super) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(super) fn minimize_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}
