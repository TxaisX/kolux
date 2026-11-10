//! Raw output (DT-C246): a batch of program output crosses to the page as one binary frame on the output
//! channel instead of base64 text inside JSON. The page then reads each chunk's bytes as a view over the one
//! buffer it fetched: no JSON parse, no base64 decode, no text copy of the output. Only this file and
//! src/terminal/outputFrame.ts know the layout; the two must agree byte for byte.
//!
//! Layout, every number little-endian:
//!   magic `K` (0x4B), version 1, u32 chunk count, then per chunk:
//!   u32 terminal id, u8 flags (bit 0: the pane key is present), u32 pane key (0 when absent),
//!   u64 generation, u64 seq, u32 byte length, the bytes.

use super::output_batch::OutputItem;

pub(crate) const MAGIC: u8 = b'K';
pub(crate) const VERSION: u8 = 1;
/// Fixed bytes per chunk ahead of its data.
const CHUNK_HEADER: usize = 4 + 1 + 4 + 8 + 8 + 4;

/// One frame holding `items` in order.
pub(crate) fn encode(items: &[OutputItem]) -> Vec<u8> {
    let size = 6 + items.iter().map(|i| CHUNK_HEADER + i.data.len()).sum::<usize>();
    let mut out = Vec::with_capacity(size);
    out.push(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&(items.len() as u32).to_le_bytes());
    for item in items {
        out.extend_from_slice(&item.id.to_le_bytes());
        out.push(u8::from(item.pane.is_some()));
        out.extend_from_slice(&item.pane.unwrap_or(0).to_le_bytes());
        out.extend_from_slice(&item.generation.to_le_bytes());
        out.extend_from_slice(&item.seq.to_le_bytes());
        out.extend_from_slice(&(item.data.len() as u32).to_le_bytes());
        out.extend_from_slice(&item.data);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_frame_layout_is_fixed_and_the_page_test_decodes_these_same_bytes() {
        // src/terminal/outputFrame.test.ts decodes this exact byte list; a change here is a change there.
        let items = vec![
            OutputItem { id: 7, data: b"hi".to_vec(), pane: Some(3), generation: 2, seq: 0x1_0000_0001 },
            OutputItem { id: 0x0102_0304, data: Vec::new(), pane: None, generation: 1, seq: 5 },
        ];
        let frame = encode(&items);
        #[rustfmt::skip]
        let expected: Vec<u8> = vec![
            b'K', 1, 2, 0, 0, 0,
            7, 0, 0, 0, 1, 3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, b'h', b'i',
            4, 3, 2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert_eq!(frame, expected);
        assert_eq!(frame.capacity(), frame.len(), "sized once, no regrowth");
    }

    #[test]
    fn an_empty_batch_is_only_the_header() {
        assert_eq!(encode(&[]), vec![b'K', 1, 0, 0, 0, 0]);
    }

    #[test]
    fn a_frame_carries_every_byte_of_a_large_chunk_as_is() {
        let data: Vec<u8> = (0..=255u8).cycle().take(300 * 1024).collect();
        let frame = encode(&[OutputItem { id: 1, data: data.clone(), pane: None, generation: 1, seq: 1 }]);
        assert_eq!(frame.len(), 6 + CHUNK_HEADER + data.len());
        assert_eq!(&frame[6 + CHUNK_HEADER..], &data[..]);
    }
}
