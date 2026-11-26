# Makes the small "Latin" copies of the Geist fonts that the pages load (about a third of the full size).
# Only English letters, accents, punctuation, the rupee sign and arrows are kept; any other character still shows,
# in the phone's own font. The visiting card keeps using the full font files.
#
#   python tools/subset-fonts.py        (needs: pip install fonttools brotli)
import os
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, '..', 'public', 'vendor', 'fonts')
# the Latin range Google Fonts uses, plus the rupee sign and arrows
UNICODES = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
            'U+2000-206F,U+20AC,U+20B9,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD')

for name, out in (('Geist-Variable.woff2', 'Geist-Latin.woff2'), ('GeistMono-Variable.woff2', 'GeistMono-Latin.woff2')):
    src, dst = os.path.join(FONTS, name), os.path.join(FONTS, out)
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']      # keep kerning, ligatures and tabular numbers
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables = []
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(UNICODES))
    sub.subset(font)
    subset.save_font(font, dst, opts)
    print(f'{out}: {os.path.getsize(src)} -> {os.path.getsize(dst)} bytes')
