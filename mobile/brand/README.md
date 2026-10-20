# Portlore icon assets

- `liner.png`: approved stronger line-art mark, used above 32px.
- `favicon.png`: approved solid companion, used at 16px and 32px.
  Its ship is enlarged and taller to fill roughly 92% width and 82% height.
  The blue background is circular, with transparent corners.

Run `npm run brand` from `mobile/` to regenerate website PNG/SVG/ICO icons,
Apple/PWA icons, Android launcher resources and splash screens. The generator
uses the image tooling already installed with `@capacitor/assets`.

The ICO includes solid 16/32px entries and line-art 48/64px entries. The website
declares explicit PNG sizes. The SVG fallback also switches artwork at 32px.
Android keeps a full background layer and pads its foreground for adaptive masks.
The notification drawable uses the compact silhouette in Android's required white.

The two source images are generated artwork selected by Nic. The line-art edit
brief preserves the approved liner's curves and gaps while increasing stroke width
about 20%. The favicon edit brief preserves its three-quarter bow, fills the hull,
keeps two deck tiers with wide gaps, and removes the small cabin and water stroke.
No app content colours or navigation symbols change with this branding update.
