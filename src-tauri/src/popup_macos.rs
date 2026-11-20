//! WebKit delegates DOM window.close() to the host. Wry currently leaves the
//! macOS window open. Forward its existing UI callbacks and handle that one event.
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, ffi, msg_send,
    rc::Retained,
    runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject, Sel},
    sel,
};
use objc2_web_kit::{WKUIDelegate, WKWebView};
use tauri::WebviewWindow;

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "YapmodPopupUIDelegate"]
    #[thread_kind = MainThreadOnly]
    #[ivars = Retained<ProtocolObject<dyn WKUIDelegate>>]
    struct PopupDelegate;

    unsafe impl NSObjectProtocol for PopupDelegate {}

    impl PopupDelegate {
        #[unsafe(method(respondsToSelector:))]
        fn responds_to(&self, selector: Sel) -> bool {
            let implemented: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            implemented || self.ivars().respondsToSelector(selector)
        }

        #[unsafe(method(forwardingTargetForSelector:))]
        fn forward_to_wry(&self, _selector: Sel) -> *const AnyObject {
            Retained::as_ptr(self.ivars()).cast()
        }
    }

    unsafe impl WKUIDelegate for PopupDelegate {
        #[unsafe(method(webViewDidClose:))]
        fn did_close(&self, view: &WKWebView) {
            if let Some(window) = view.window() {
                window.performClose(None);
            }
        }
    }
);

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| {
        let main = MainThreadMarker::new().expect("WebKit callback runs on the main thread");
        // SAFETY: platform.inner() is the live WKWebView of this popup, on its UI thread.
        let view = unsafe { &*platform.inner().cast::<WKWebView>() };
        let Some(original) = (unsafe { view.UIDelegate() }) else {
            return;
        };
        if original.respondsToSelector(sel!(webViewDidClose:)) {
            return;
        }

        let instance = PopupDelegate::alloc(main).set_ivars(original);
        let delegate: Retained<PopupDelegate> = unsafe { msg_send![super(instance), init] };
        // WKWebView retains its delegate weakly. Keep the forwarding object alive
        // exactly as long as this popup, using an address unique to this module.
        static ASSOCIATION_KEY: u8 = 0;
        unsafe {
            ffi::objc_setAssociatedObject(
                platform.inner().cast(),
                (&raw const ASSOCIATION_KEY).cast(),
                Retained::as_ptr(&delegate).cast_mut().cast(),
                ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
            view.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        }
    })
}
