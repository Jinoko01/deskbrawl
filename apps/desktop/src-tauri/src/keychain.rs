use std::ffi::c_void;
use std::ptr::{null, null_mut};

const SERVICE: &[u8] = b"dev.deskbrawl.desktop";
const ACCOUNT: &[u8] = b"device-credential";
const ITEM_NOT_FOUND: i32 = -25300;
const DUPLICATE_ITEM: i32 = -25299;

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    fn SecKeychainFindGenericPassword(
        keychain_or_array: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        password_len: *mut u32,
        password: *mut *mut c_void,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainAddGenericPassword(
        keychain: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        password_len: u32,
        password: *const c_void,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainItemModifyAttributesAndData(
        item: *mut c_void,
        attributes: *const c_void,
        len: u32,
        data: *const c_void,
    ) -> i32;
    fn SecKeychainItemFreeContent(attributes: *mut c_void, data: *mut c_void) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(object: *const c_void);
}

#[derive(Default)]
struct Item(*mut c_void);

impl Drop for Item {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: a successful find returned a retained Keychain item.
            unsafe { CFRelease(self.0) };
        }
    }
}

#[derive(Default)]
struct Password(*mut c_void);

impl Drop for Password {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: Keychain allocated this buffer and requires FreeContent to release it.
            unsafe { SecKeychainItemFreeContent(null_mut(), self.0) };
        }
    }
}

fn find(len: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32 {
    // SAFETY: fixed service and account buffers match their lengths. Each output is
    // either null or writable for this call. Null searches the user's keychains.
    unsafe {
        SecKeychainFindGenericPassword(
            null(),
            SERVICE.len() as u32,
            SERVICE.as_ptr(),
            ACCOUNT.len() as u32,
            ACCOUNT.as_ptr(),
            len,
            data,
            item,
        )
    }
}

pub fn read() -> Result<Option<String>, &'static str> {
    let mut len = 0;
    let mut data = Password::default();
    match find(&mut len, &mut data.0, null_mut()) {
        ITEM_NOT_FOUND => return Ok(None),
        0 => {}
        _ => return Err("CREDENTIAL_READ_FAILED"),
    }
    if data.0.is_null() || !(1..=4096).contains(&len) {
        return Err("INVALID_CREDENTIAL");
    }
    // SAFETY: a successful find returned len bytes owned by data until it is dropped.
    let bytes = unsafe { std::slice::from_raw_parts(data.0.cast::<u8>(), len as usize) };
    std::str::from_utf8(bytes)
        .map(|value| Some(value.to_owned()))
        .map_err(|_| "INVALID_CREDENTIAL")
}

pub fn write(bytes: &[u8]) -> Result<(), &'static str> {
    let len = u32::try_from(bytes.len()).map_err(|_| "INVALID_CREDENTIAL")?;
    let mut item = Item::default();
    let mut status = find(null_mut(), null_mut(), &mut item.0);
    if status == ITEM_NOT_FOUND {
        // SAFETY: all inputs match their lengths. The default keychain owns the new item.
        status = unsafe {
            SecKeychainAddGenericPassword(
                null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr(),
                len,
                bytes.as_ptr().cast(),
                null_mut(),
            )
        };
        if status == 0 {
            return Ok(());
        }
        if status == DUPLICATE_ITEM {
            status = find(null_mut(), null_mut(), &mut item.0);
        }
    }
    if status != 0 || item.0.is_null() {
        return Err("CREDENTIAL_WRITE_FAILED");
    }
    // SAFETY: item is retained and bytes stays live during the synchronous update.
    let status = unsafe {
        SecKeychainItemModifyAttributesAndData(item.0, null(), len, bytes.as_ptr().cast())
    };
    if status == 0 {
        Ok(())
    } else {
        Err("CREDENTIAL_WRITE_FAILED")
    }
}
