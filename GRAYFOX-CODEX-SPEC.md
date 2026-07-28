# Grayfox implementation specification

This local project follows the supplied Grayfox design system.

## Product priority

1. Working video workflows
2. Clean, legible interaction design
3. Visual polish
4. Decorative motion only when it improves understanding

## Core system

- Warm neutral canvas: `#FAFAF8`
- White surfaces: `#FFFFFF`
- Selected surface: `#E7E5DC`
- Border: `#D2CFCA`
- Primary text: `#18181B`
- Secondary text: `#6B6A66`
- Muted text: `#AEADA6`
- Dark video context: `#0B0B0B`
- Blood Red primary action: `#9D1F1C`
- Blood Red active/focus state: `#C41E1E`
- Muted Gold is reserved for storyboard context
- Geist-style UI typography with mono typography for system data
- 8px spacing grid
- 4px standard radius and 10px large-panel radius
- Minimum 44px primary touch targets
- Two-pixel red focus outline with two-pixel offset
- Reduced-motion support

## Feature decisions

- Tone tokens remain separate from the full editing direction.
- Full-video and Shorts workflows both accept tone guidance.
- The live AI brief makes the effect of tone tokens visible.
- Animated katana/reel and folding-fan/camera illustrations are deferred until the main AI/video pipeline is functional.
