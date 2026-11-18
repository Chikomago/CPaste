#![cfg(target_os = "macos")]
use std::{cell::RefCell, path::PathBuf, sync::{mpsc, Arc}, time::Instant};
use objc2::{define_class, msg_send, rc::Retained, runtime::{AnyObject, ProtocolObject}, MainThreadOnly, DefinedClass};
use objc2_foundation::{NSObject, NSObjectProtocol, NSString, NSNotification, NSPoint, NSRect, NSSize};
use objc2_app_kit::*;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::{Code, HotKey, Modifiers}};
use rusqlite::{Connection, OpenFlags};

#[path = "../../../src-tauri/src/privacy.rs"]
mod privacy;

struct Record { display: String, search: String }
struct Query { text: String, generation: u64, started: Instant }
struct Ui {
    panel: Retained<BenchPanel>,
    search: Retained<NSSearchField>,
    table: Retained<NSTableView>,
    records: Arc<Vec<Record>>,
    visible: RefCell<Vec<usize>>,
    generation: RefCell<u64>,
    sender: mpsc::Sender<Query>,
}
thread_local! { static UI: RefCell<Option<Retained<Controller>>> = const { RefCell::new(None) }; }

define_class!(
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    struct BenchPanel;
    unsafe impl NSObjectProtocol for BenchPanel {}
    impl BenchPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool { true }
        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool { false }
        #[unsafe(method(cancelOperation:))]
        fn cancel_operation(&self, _sender: Option<&AnyObject>) { self.orderOut(None); }
    }
);

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Ui]
    struct Controller;
    unsafe impl NSObjectProtocol for Controller {}
    unsafe impl NSTableViewDataSource for Controller {
        #[unsafe(method(numberOfRowsInTableView:))]
        fn row_count(&self, _table: &NSTableView) -> isize { self.ivars().visible.borrow().len() as isize }
        #[unsafe(method_id(tableView:objectValueForTableColumn:row:))]
        fn row_value(&self, _table: &NSTableView, _column: Option<&NSTableColumn>, row: isize) -> Option<Retained<AnyObject>> {
            let index = usize::try_from(row).ok().and_then(|row| self.ivars().visible.borrow().get(row).copied());
            index.map(|index| NSString::from_str(&self.ivars().records[index].display).into_super().into_super())
        }
    }
    unsafe impl NSControlTextEditingDelegate for Controller {
        #[unsafe(method(controlTextDidChange:))]
        fn query_changed(&self, _notification: &NSNotification) {
            let mut generation = self.ivars().generation.borrow_mut();
            *generation += 1;
            let _ = self.ivars().sender.send(Query { text: self.ivars().search.stringValue().to_string(), generation: *generation, started: Instant::now() });
        }
    }
    unsafe impl NSTextFieldDelegate for Controller {}
    unsafe impl NSSearchFieldDelegate for Controller {}
);

fn show() {
    UI.with(|state| {
        if let Some(controller) = state.borrow().as_ref() {
            let ui = controller.ivars();
            if ui.panel.isVisible() { ui.panel.orderOut(None); return; }
            ui.search.setStringValue(&NSString::from_str(""));
            *ui.visible.borrow_mut() = (0..ui.records.len().min(300)).collect();
            *ui.generation.borrow_mut() += 1;
            ui.table.reloadData();
            ui.panel.center();
            ui.panel.makeKeyAndOrderFront(None);
            ui.panel.makeFirstResponder(Some(&ui.search));
        }
    });
}

fn main() {
    let started = Instant::now();
    let path = std::env::var_os("CPASTE_BENCH_DATABASE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap()).join("Library/Application Support/app.cpaste.desktop/cpaste.db"));
    let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("Open existing database read-only");
    let raw: String = db.query_row("SELECT value FROM app_settings WHERE key='preferences'", [], |r| r.get(0)).unwrap_or_else(|_| "{}".into());
    let prefs: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let use_dictionary = prefs["segment_builtin_dictionary"].as_bool().unwrap_or(true);
    let masking = prefs["sensitive_action"].as_str().unwrap_or("mask") == "mask";
    let mut statement = db.prepare("SELECT kind,title,plain_text,source_app,html,rtf,files_json FROM clips ORDER BY pinned DESC,id DESC").unwrap();
    let records: Vec<Record> = statement.query_map([], |row| {
        let kind: String = row.get(0)?;
        let title: String = row.get(1)?;
        let text: String = row.get(2)?;
        let source: String = row.get(3)?;
        let html: Option<String> = row.get(4)?;
        let rtf: Option<String> = row.get(5)?;
        let files: Vec<String> = serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default();
        let sensitive = masking && privacy::contains_sensitive(&text, html.as_deref(), rtf.as_deref(), &files);
        let text = if sensitive { privacy::mask_sensitive(&text) } else if text.is_empty() { title } else { text };
        let preview: String = text.chars().take(140).collect();
        let label = match kind.as_str() { "image" => "图片", "files" => "文件", "rich" => "富文本", _ => "纯文本" };
        Ok(Record { display: format!("{label}　{source}\n{preview}"), search: format!("{text} {source} {}", if sensitive { String::new() } else { files.join(" ") }).to_lowercase() })
    }).unwrap().map(Result::unwrap).collect();
    let records = Arc::new(records);
    eprintln!("native_bench pid={} rows={} readonly_db_ms={:.3}", std::process::id(), records.len(), started.elapsed().as_secs_f64()*1000.0);
    drop(statement); drop(db);
    let (sender, receiver) = mpsc::channel::<Query>();
    let search_records = records.clone();
    std::thread::spawn(move || {
        let mut dictionary = None;
        while let Ok(mut query) = receiver.recv() {
            while let Ok(newer) = receiver.try_recv() { query = newer; }
            let needle = query.text.trim().to_lowercase();
            if use_dictionary && !needle.is_empty() && dictionary.is_none() {
                let loaded = Instant::now();
                let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
                let raw: String = db.query_row("SELECT value FROM app_settings WHERE key='segmentation_downloaded_words'", [], |r| r.get(0)).unwrap_or_default();
                let mut jieba = jieba_rs::Jieba::empty();
                if !raw.is_empty() { jieba.load_dict(&mut std::io::Cursor::new(raw.as_bytes())).unwrap(); }
                dictionary = Some(jieba);
                eprintln!("native_bench dictionary_init_ms={:.3}", loaded.elapsed().as_secs_f64()*1000.0);
            }
            let terms: Vec<String> = dictionary.as_ref().map(|d| d.cut(&needle, false).iter().filter(|x| !x.word.trim().is_empty()).map(|x| x.word.to_string()).collect()).unwrap_or_else(|| needle.split_whitespace().map(str::to_owned).collect());
            let ids: Vec<usize> = search_records.iter().enumerate().filter(|(_, record)| needle.is_empty() || record.search.contains(&needle) || (!terms.is_empty() && terms.iter().all(|term| record.search.contains(term)))).take(300).map(|(index,_)| index).collect();
            dispatch2::DispatchQueue::main().exec_async(move || UI.with(|state| {
                if let Some(controller) = state.borrow().as_ref() {
                    if *controller.ivars().generation.borrow() == query.generation {
                        *controller.ivars().visible.borrow_mut() = ids;
                        controller.ivars().table.reloadData();
                        controller.ivars().table.displayIfNeeded();
                        eprintln!("native_bench query_ms={:.3} matches={}", query.started.elapsed().as_secs_f64()*1000.0, controller.ivars().visible.borrow().len());
                    }
                }
            }));
        }
    });
    let mtm = objc2::MainThreadMarker::new().unwrap();
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let frame = NSRect::new(NSPoint::new(0.0,0.0),NSSize::new(350.0,600.0));
    let panel: Retained<BenchPanel> = unsafe { msg_send![BenchPanel::alloc(mtm), initWithContentRect:frame, styleMask:NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::NonactivatingPanel, backing:NSBackingStoreType::Buffered, defer:false] };
    panel.setTitle(&NSString::from_str("CPaste · Rust 原生只读对照"));
    unsafe { panel.setReleasedWhenClosed(false); }
    panel.setFloatingPanel(true);
    panel.setHasShadow(true);
    let content = panel.contentView().unwrap();
    let search = NSSearchField::initWithFrame(NSSearchField::alloc(mtm),NSRect::new(NSPoint::new(12.0,548.0),NSSize::new(326.0,36.0)));
    search.setPlaceholderString(Some(&NSString::from_str("搜索")));
    content.addSubview(&search);
    let scroll = NSScrollView::initWithFrame(NSScrollView::alloc(mtm),NSRect::new(NSPoint::new(8.0,12.0),NSSize::new(334.0,524.0)));
    scroll.setHasVerticalScroller(true);
    let table = NSTableView::initWithFrame(NSTableView::alloc(mtm),NSRect::new(NSPoint::new(0.0,0.0),NSSize::new(320.0,524.0)));
    table.setHeaderView(None); table.setRowHeight(68.0);
    let column = NSTableColumn::initWithIdentifier(NSTableColumn::alloc(mtm), &NSString::from_str("record"));
    column.setWidth(316.0);
    let cell = NSTextFieldCell::initTextCell(NSTextFieldCell::alloc(mtm),&NSString::from_str(""));
    cell.setWraps(true); cell.setFont(Some(&NSFont::systemFontOfSize(14.0)));
    unsafe { column.setDataCell(&cell); }
    table.addTableColumn(&column);
    scroll.setDocumentView(Some(&table)); content.addSubview(&scroll);
    let count = records.len();
    let allocated = Controller::alloc(mtm).set_ivars(Ui { panel, search, table, records, visible: RefCell::new((0..count.min(300)).collect()), generation: RefCell::new(0), sender });
    let controller: Retained<Controller> = unsafe { msg_send![super(allocated), init] };
    unsafe { controller.ivars().table.setDataSource(Some(ProtocolObject::from_ref(&*controller))); controller.ivars().search.setDelegate(Some(ProtocolObject::from_ref(&*controller))); }
    UI.with(|state| *state.borrow_mut()=Some(controller));
    let manager = GlobalHotKeyManager::new().unwrap();
    let hotkey = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),Code::KeyV);
    let quit = HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),Code::KeyQ);
    manager.register(hotkey).unwrap(); manager.register(quit).unwrap();
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.state == HotKeyState::Pressed {
            dispatch2::DispatchQueue::main().exec_async(move || {
                if event.id == hotkey.id() { show(); }
                else if event.id == quit.id() { NSApplication::sharedApplication(objc2::MainThreadMarker::new().unwrap()).terminate(None); }
            });
        }
    }));
    eprintln!("native_bench ready toggle=Control+Option+Shift+V quit=Control+Option+Shift+Q");
    app.run();
}
