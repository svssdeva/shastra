use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;

use crate::types::{CollectorOutput, TrishulError};

#[derive(Debug, Serialize)]
pub struct UsbDevice {
    pub path: String,
    pub id_vendor: String,
    pub id_product: String,
    pub vendor_name: Option<String>,
    pub product_name: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub bus: Option<u32>,
    pub dev_num: Option<u32>,
    pub speed_mbps: Option<u32>,
}

pub fn collect_usb_devices() -> Result<CollectorOutput, TrishulError> {
    let root = Path::new("/sys/bus/usb/devices");
    if !root.exists() {
        return Ok(CollectorOutput::new(
            "no USB sysfs at /sys/bus/usb/devices",
            json!({"devices": []}),
        )
        .with_warning("/sys/bus/usb/devices missing — running in a container or non-USB host?"));
    }
    let mut devs = Vec::new();
    let entries = fs::read_dir(root).map_err(TrishulError::Io)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let id_vendor = read_trim(&path.join("idVendor"));
        let id_product = read_trim(&path.join("idProduct"));
        if id_vendor.is_empty() || id_product.is_empty() {
            // Hubs and interfaces show up too; skip ones without vendor/product IDs.
            continue;
        }
        let manufacturer = read_trim_opt(&path.join("manufacturer"));
        let product = read_trim_opt(&path.join("product"));
        let bus = read_trim_opt(&path.join("busnum")).and_then(|s| s.parse().ok());
        let dev_num = read_trim_opt(&path.join("devnum")).and_then(|s| s.parse().ok());
        let speed_mbps = read_trim_opt(&path.join("speed")).and_then(|s| s.parse().ok());
        devs.push(UsbDevice {
            path: path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            id_vendor: id_vendor.clone(),
            id_product: id_product.clone(),
            vendor_name: None,
            product_name: None,
            manufacturer,
            product,
            bus,
            dev_num,
            speed_mbps,
        });
    }

    // Best-effort vendor/product name lookup via /usr/share/hwdata/usb.ids
    let mut warnings = Vec::new();
    if let Some(ids) = load_usb_ids("/usr/share/hwdata/usb.ids")
        .or_else(|| load_usb_ids("/usr/share/misc/usb.ids"))
    {
        for d in devs.iter_mut() {
            if let Some(vname) = ids.vendor(&d.id_vendor) {
                d.vendor_name = Some(vname.0.clone());
                if let Some(pname) = vname.1.get(&d.id_product) {
                    d.product_name = Some(pname.clone());
                }
            }
        }
    } else {
        warnings.push("usb.ids not found; vendor/product names not resolved".into());
    }

    devs.sort_by(|a, b| (a.bus, a.dev_num).cmp(&(b.bus, b.dev_num)));
    let summary = format!("{} USB device(s) detected", devs.len());
    let data = json!({ "devices": devs });
    let mut out = CollectorOutput::new(summary, data);
    out.warnings.extend(warnings);
    Ok(out)
}

fn read_trim(p: &PathBuf) -> String {
    fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_default()
}

fn read_trim_opt(p: &PathBuf) -> Option<String> {
    let s = read_trim(p);
    if s.is_empty() { None } else { Some(s) }
}

struct UsbIds {
    // vendor_id (4 lowercase hex) -> (vendor_name, products: product_id -> product_name)
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
    let text = fs::read_to_string(path).ok()?;
    let mut map: std::collections::HashMap<String, (String, std::collections::HashMap<String, String>)> =
        std::collections::HashMap::new();
    let mut current_vid: Option<String> = None;
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            // Vendor line: "VVVV  Name"
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
            // Interface or class — skip.
            continue;
        } else {
            // Product line: "\tPPPP  Name"
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
        .unwrap();
        let ids = load_usb_ids(path.to_str().unwrap()).unwrap();
        let (vname, prods) = ids.vendor("1234").unwrap();
        assert_eq!(vname, "Acme Corp");
        assert_eq!(prods.get("abcd").unwrap(), "Acme Widget");
    }
}
