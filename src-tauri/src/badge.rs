use tauri::{AppHandle, Manager, Webview};

#[tauri::command]
pub fn desktop_set_badge(
    webview: Webview,
    app: AppHandle,
    count: Option<i64>,
) -> Result<(), String> {
    if webview.label() != "yapin"
        || !webview
            .url()
            .is_ok_and(|url| crate::navigation::is_yapin(&url))
    {
        return Err("Badges require the Yapin window".into());
    }
    apply(&app, count).map_err(|error| error.to_string())
}

fn badge_target(count: Option<i64>) -> Option<i64> {
    count.filter(|count| *count > 0).map(|count| count.min(99))
}

pub fn apply(app: &AppHandle, count: Option<i64>) -> tauri::Result<()> {
    let Some(window) = app.get_window("main") else {
        return Ok(());
    };
    let count = badge_target(count);
    #[cfg(target_os = "windows")]
    return window.set_overlay_icon(count.map(overlay::render));
    #[cfg(not(target_os = "windows"))]
    window.set_badge_count(count)
}

// Adapted from ilyeshdz/yapmod's src-tauri/src/badge.rs (GPL-3.0).
#[cfg(any(target_os = "windows", test))]
mod overlay {
    use tauri::image::Image;

    /// The size of the image, in pixels.
    ///
    /// Windows scales the image down to the size of the taskbar icon.
    const SIZE: usize = 32;

    /// The color of the badge.
    const BACKGROUND: [u8; 4] = [220, 38, 38, 255];

    /// The color of the number.
    const FOREGROUND: [u8; 4] = [255, 255, 255, 255];

    /// The width of a digit, in pixels.
    const GLYPH_WIDTH: usize = 3;

    /// The height of a digit, in pixels.
    const GLYPH_HEIGHT: usize = 5;

    /// How much bigger a digit is drawn than its bitmap.
    const SCALE: usize = 4;

    /// The space between two digits, in pixels.
    const GAP: usize = SCALE;

    /// The digits, one bitmap per digit, five rows of three pixels.
    ///
    /// Every row is a bitmask, where the highest bit is the leftmost pixel.
    const DIGITS: [[u8; GLYPH_HEIGHT]; 10] = [
        [0b111, 0b101, 0b101, 0b101, 0b111],
        [0b010, 0b110, 0b010, 0b010, 0b111],
        [0b111, 0b001, 0b111, 0b100, 0b111],
        [0b111, 0b001, 0b111, 0b001, 0b111],
        [0b101, 0b101, 0b111, 0b001, 0b001],
        [0b111, 0b100, 0b111, 0b001, 0b111],
        [0b111, 0b100, 0b111, 0b101, 0b111],
        [0b111, 0b001, 0b010, 0b010, 0b010],
        [0b111, 0b101, 0b111, 0b101, 0b111],
        [0b111, 0b101, 0b111, 0b001, 0b111],
    ];

    /// Draws the number of unread messages.
    pub fn render(count: i64) -> Image<'static> {
        let text = count.to_string();
        let digits: Vec<&[u8; GLYPH_HEIGHT]> = text
            .chars()
            .filter_map(|character| DIGITS.get(character.to_digit(10)? as usize))
            .collect();

        let mut pixels = vec![0u8; SIZE * SIZE * 4];

        draw_circle(&mut pixels);
        draw_digits(&mut pixels, &digits);

        Image::new_owned(pixels, SIZE as u32, SIZE as u32)
    }

    /// Fills the pixels that fall inside the badge.
    fn draw_circle(pixels: &mut [u8]) {
        let center = SIZE as f32 / 2.0;
        let radius = center - 1.0;

        for y in 0..SIZE {
            for x in 0..SIZE {
                let dx = x as f32 + 0.5 - center;
                let dy = y as f32 + 0.5 - center;

                if dx * dx + dy * dy > radius * radius {
                    continue;
                }

                put(pixels, x, y, BACKGROUND);
            }
        }
    }

    /// Draws the digits in the middle of the badge.
    fn draw_digits(pixels: &mut [u8], digits: &[&[u8; GLYPH_HEIGHT]]) {
        if digits.is_empty() {
            return;
        }

        let width = digits.len() * GLYPH_WIDTH * SCALE + (digits.len() - 1) * GAP;
        let start_x = (SIZE.saturating_sub(width)) / 2;
        let start_y = (SIZE.saturating_sub(GLYPH_HEIGHT * SCALE)) / 2;

        for (index, digit) in digits.iter().enumerate() {
            let offset = index * (GLYPH_WIDTH * SCALE + GAP);

            for (row, bits) in digit.iter().enumerate() {
                for column in 0..GLYPH_WIDTH {
                    if bits & (1 << (GLYPH_WIDTH - 1 - column)) == 0 {
                        continue;
                    }

                    for scale_y in 0..SCALE {
                        for scale_x in 0..SCALE {
                            let x = start_x + offset + column * SCALE + scale_x;
                            let y = start_y + row * SCALE + scale_y;

                            if x >= SIZE || y >= SIZE {
                                continue;
                            }

                            put(pixels, x, y, FOREGROUND);
                        }
                    }
                }
            }
        }
    }

    /// Puts one pixel on the canvas.
    fn put(pixels: &mut [u8], x: usize, y: usize, color: [u8; 4]) {
        let index = (y * SIZE + x) * 4;

        pixels[index..index + 4].copy_from_slice(&color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_clear_or_fit_two_digits() {
        for count in [None, Some(i64::MIN), Some(-1), Some(0)] {
            assert_eq!(badge_target(count), None);
        }
        assert_eq!(badge_target(Some(1)), Some(1));
        assert_eq!(badge_target(Some(99)), Some(99));
        assert_eq!(badge_target(Some(i64::MAX)), Some(99));
    }

    #[test]
    fn windows_overlay_has_transparent_corners_and_distinct_numbers() {
        let one = overlay::render(1);
        let ninety_nine = overlay::render(99);
        assert_eq!((one.width(), one.height()), (32, 32));
        assert_eq!(one.rgba().len(), 32 * 32 * 4);
        assert_eq!(&one.rgba()[..4], &[0, 0, 0, 0]);
        let (pixels, _) = one.rgba().as_chunks::<4>();
        assert!(pixels.contains(&[255, 255, 255, 255]));
        assert!(pixels.contains(&[220, 38, 38, 255]));
        assert_ne!(one.rgba(), ninety_nine.rgba());
    }
}
