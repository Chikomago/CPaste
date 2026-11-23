//! Pure physical-coordinate geometry shared by opening and resizing the picker.
#[derive(Debug, PartialEq)]
pub(crate) struct PanelBounds {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

pub(crate) fn fit_panel(
    origin: (i32, i32),
    available: (u32, u32),
    scale: f64,
    desired: (f64, f64),
    anchor: Option<(f64, f64)>,
) -> PanelBounds {
    let width = ((desired.0 * scale).round() as u32).clamp(1, available.0.max(1));
    let height = ((desired.1 * scale).round() as u32).clamp(1, available.1.max(1));
    let left = f64::from(origin.0);
    let top = f64::from(origin.1);
    let max_x = left + f64::from(available.0.saturating_sub(width));
    let max_y = top + f64::from(available.1.saturating_sub(height));
    let (x, y) = anchor.unwrap_or(((left + max_x) / 2.0, (top + max_y) / 2.0));
    PanelBounds {
        x: x.round().clamp(left, max_x) as i32,
        y: y.round().clamp(top, max_y) as i32,
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_layouts_and_detail_states_fit_every_edge_at_mixed_scales() {
        let sizes = [
            (378.0, 660.0),
            (728.0, 660.0),
            (800.0, 318.0),
            (800.0, 660.0),
            (342.0, 660.0),
        ];
        for (origin, available, scale) in [
            ((0, 25), (1440, 815), 1.0),
            ((-2560, -1440), (2560, 1370), 2.0),
            ((1920, 40), (1920, 1000), 1.25),
            ((0, 24), (640, 456), 1.0),
        ] {
            for size in sizes {
                for anchor in [
                    None,
                    Some((-9999.0, -9999.0)),
                    Some((9999.0, 9999.0)),
                    Some((origin.0 as f64 + 20.0, origin.1 as f64 + 20.0)),
                ] {
                    let bounds = fit_panel(origin, available, scale, size, anchor);
                    assert!(bounds.x >= origin.0 && bounds.y >= origin.1);
                    assert!(
                        i64::from(bounds.x) + i64::from(bounds.width)
                            <= i64::from(origin.0) + i64::from(available.0)
                    );
                    assert!(
                        i64::from(bounds.y) + i64::from(bounds.height)
                            <= i64::from(origin.1) + i64::from(available.1)
                    );
                }
            }
        }
    }

    #[test]
    fn expansion_moves_only_as_far_as_needed_and_is_idempotent() {
        let fitted = fit_panel(
            (0, 24),
            (1440, 816),
            1.0,
            (728.0, 660.0),
            Some((1062.0, 400.0)),
        );
        assert_eq!(
            fitted,
            PanelBounds {
                x: 712,
                y: 180,
                width: 728,
                height: 660
            }
        );
        assert_eq!(
            fit_panel(
                (0, 24),
                (1440, 816),
                1.0,
                (728.0, 660.0),
                Some((fitted.x as f64, fitted.y as f64))
            ),
            fitted
        );
        let unchanged = fit_panel(
            (0, 24),
            (1440, 816),
            1.0,
            (378.0, 660.0),
            Some((100.0, 80.0)),
        );
        assert_eq!((unchanged.x, unchanged.y), (100, 80));
    }
}
