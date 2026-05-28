//! Cross-platform USB enumeration via `nusb` (pure Rust, no libusb system dep).
//!
//! Works identically on Linux, macOS, and Windows. The implementation does not
//! open any USB device — it only walks the device list and reads descriptor
//! metadata that the OS already cached. No special permissions required.

use nusb::MaybeFuture;
use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct UsbDevice {
    pub bus_id: String,
    pub addr: u8,
    pub id_vendor: String,    // 4-hex lowercase
    pub id_product: String,   // 4-hex lowercase
    pub vendor_name: Option<String>,
    pub product_name: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub class: u8,
    pub subclass: u8,
    pub protocol: u8,
    pub speed: Option<&'static str>,
}

pub fn collect_usb_devices() -> Result<CollectorOutput, TrishulError> {
    let devices = nusb::list_devices()
        .wait()
        .map_err(|e| TrishulError::Procfs(format!("nusb::list_devices: {e}")))?;

    let mut out = Vec::new();
    for info in devices {
        out.push(UsbDevice {
            bus_id: info.bus_id().to_string(),
            addr: info.device_address(),
            id_vendor: format!("{:04x}", info.vendor_id()),
            id_product: format!("{:04x}", info.product_id()),
            vendor_name: None,   // populated below from usb.ids if available
            product_name: None,
            manufacturer: info.manufacturer_string().map(|s| s.to_string()),
            product: info.product_string().map(|s| s.to_string()),
            serial: info.serial_number().map(|s| s.to_string()),
            class: info.class(),
            subclass: info.subclass(),
            protocol: info.protocol(),
            speed: info.speed().map(speed_label),
        });
    }

    // Best-effort vendor/product name lookup from usb.ids (Linux-distro convention).
    // Mac and Windows users won't have this file by default; the manufacturer/product
    // strings from the USB descriptors themselves (read above) cover the gap.
    let mut warnings = Vec::new();
    if let Some(ids) = load_usb_ids("/usr/share/hwdata/usb.ids")
        .or_else(|| load_usb_ids("/usr/share/misc/usb.ids"))
        .or_else(|| load_usb_ids("/var/lib/usbutils/usb.ids"))
    {
        for d in out.iter_mut() {
            if let Some(v) = ids.vendor(&d.id_vendor) {
                d.vendor_name = Some(v.0.clone());
                if let Some(p) = v.1.get(&d.id_product) {
                    d.product_name = Some(p.clone());
                }
            }
        }
    } else if out.iter().any(|d| d.manufacturer.is_none() && d.product.is_none()) {
        warnings.push(
            "usb.ids not found; some devices have no vendor/product names. \
             Descriptor-supplied strings used where present."
                .into(),
        );
    }

    out.sort_by(|a, b| a.bus_id.cmp(&b.bus_id).then(a.addr.cmp(&b.addr)));
    let summary = format!("{} USB device(s) detected", out.len());
    let data = json!({ "devices": out });
    let mut output = CollectorOutput::new(summary, data);
    output.warnings.extend(warnings);
    Ok(output)
}

fn speed_label(s: nusb::Speed) -> &'static str {
    use nusb::Speed::*;
    match s {
        Low => "low (1.5 Mbps)",
        Full => "full (12 Mbps)",
        High => "high (480 Mbps)",
        Super => "super (5 Gbps)",
        SuperPlus => "super-plus (10+ Gbps)",
        _ => "unknown",
    }
}

struct UsbIds {
    map: std::collections::HashMap<String, (String, std::collections::HashMap<String, String>)>,
}

impl UsbIds {
    fn vendor(
        &self,
        id: &str,
    ) -> Option<&(String, std::collections::HashMap<String, String>)> {
        self.map.get(&id.to_ascii_lowercase())
    }
}

fn load_usb_ids(path: &str) -> Option<UsbIds> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut map: std::collections::HashMap<String, (String, std::collections::HashMap<String, String>)> =
        std::collections::HashMap::new();
    let mut current_vid: Option<String> = None;
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            let mut sp = line.splitn(2, ' ');
            let id = sp.next()?.to_ascii_lowercase();
            let name = sp.next().unwrap_or("").trim_start().to_string();
            if id.len() == 4 {
                map.insert(id.clone(), (name, std::collections::HashMap::new()));
                current_vid = Some(id);
            } else {
                current_vid = None;
            }
        } else if line.starts_with("\t\t") {
            continue;
        } else {
            let trimmed = line.trim_start_matches('\t');
            let mut sp = trimmed.splitn(2, ' ');
            let pid = sp.next()?.to_ascii_lowercase();
            let pname = sp.next().unwrap_or("").trim_start().to_string();
            if let Some(vid) = current_vid.as_ref()
                && pid.len() == 4
                && let Some((_, prods)) = map.get_mut(vid)
            {
                prods.insert(pid, pname);
            }
        }
    }
    Some(UsbIds { map })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_usb_ids_minimal() {
        let path = std::env::temp_dir().join("trishul-usb-ids-test.txt");
        std::fs::write(
            &path,
            "# comment\n1234  Acme Corp\n\tabcd  Acme Widget\n\t\tInterface stuff\n",
        )
        .expect("write fixture");
        let ids = load_usb_ids(path.to_str().expect("utf-8 path")).expect("load");
        let (vname, prods) = ids.vendor("1234").expect("vendor");
        assert_eq!(vname, "Acme Corp");
        assert_eq!(prods.get("abcd").expect("product"), "Acme Widget");
    }
}
