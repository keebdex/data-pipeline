const axios = require('axios')
const { parse, format } = require('date-fns')
const { removeHtmlTags, getProfileInfo } = require('../utils')
const { urlSlugify } = require('../../utils')

function parseDate(dateStr) {
    if (!dateStr) return null
    const formats = [
        'MMMM do yyyy', // October 19th 2025
        'do MMMM yyyy', // 19th October 2025
    ]

    for (const fmt of formats) {
        try {
            const parsed = parse(dateStr.trim(), fmt, new Date())
            if (!isNaN(parsed.getTime())) {
                return format(parsed, 'yyyy-MM-dd')
            }
        } catch {
            // ignore and try next format
        }
    }

    return null
}

function extractGroupBuyInfo(text = '') {
    const startMatch = text.match(/Group\s*Buy\s*Starts:\s*([^\n]+)/i)
    const endMatch = text.match(
        /(Closing\s*Date|Group\s*Buy\s*Ends):\s*([^\n]+)/i,
    )

    const clean = (str) => (str ? str.replace(/Closing.*$/i, '').trim() : null)
    const start = clean(startMatch ? startMatch[1] : null)
    const end = clean(endMatch ? endMatch[2] : null)

    return {
        start_date: parseDate(start),
        end_date: parseDate(end),
    }
}

function normalizeKitName(rawName = '') {
    let kitName = rawName.split('-').pop().trim()

    // Remove trailing "Kit"
    kitName = kitName.replace(/\s*Kit$/i, '').trim()

    // Collapse multiple spaces
    kitName = kitName.replace(/\s+/g, ' ')

    return kitName
}

function mapStatus(tags = []) {
    const lowerTags = tags.map((t) => t.toLowerCase())

    if (lowerTags.some((t) => t.includes('coming soon'))) return 'Scheduled'
    if (lowerTags.some((t) => t.includes('live gb'))) return 'Live'
    if (lowerTags.some((t) => t.includes('pre-order'))) return 'In Production'
    if (lowerTags.some((t) => t.includes('in stock'))) return 'Complete'

    return null
}

async function fetchKeysets() {
    const url = 'https://prototypist.net/products.json'
    const response = await axios.get(url)
    const { products } = response.data

    return products
        .filter((p) => p.product_type === 'Keycaps')
        .map((p) => {
            // remove parentheses ( … )
            let baseName = p.title.replace(/\([^)]*\)/g, '').trim()

            // detect profile & clean name
            const { profileId, cleanedName } = getProfileInfo(baseName)
            if (!profileId) return null

            // remove trailing "Keycaps" word & collapse spaces
            let finalName = cleanedName.replace(/\bKeycaps?\b/gi, '').trim()
            finalName = finalName.replace(/\s+/g, ' ')

            // Generate slug
            const slug = urlSlugify(finalName)
            const profile_keyset_id = `${profileId}/${slug}`

            // variants → kits
            const kits = p.variants
                .filter(
                    (k) =>
                        !(
                            k.title.toLowerCase().includes('deskmat') ||
                            k.title.toLowerCase().includes('deskpad')
                        ),
                )
                .map((v) => ({
                    name: normalizeKitName(v.title),
                    price: parseFloat(v.price),
                    profile_keyset_id,
                    img: v.featured_image?.src ?? null,
                }))

            // extract & clean description
            let rawDescription = removeHtmlTags(p.body_html)
            const groupBuy = extractGroupBuyInfo(rawDescription)

            return {
                keyset: {
                    name: finalName,
                    profile_keyset_id,
                    profile_id: profileId,
                    url: `https://prototypist.net/products/${p.handle}`,
                    // description: description.replace(/\s+/g, ' '),
                    status: mapStatus(p.tags),
                    // render_img: p.images[0]?.src ?? null,
                    img: p.images[0]?.src ?? null,
                    review_status: 'Pending',
                    ...groupBuy,
                },
                kits,
            }
        })
        .filter(Boolean)
}

module.exports = { name: 'ProtoTypist', fetchKeysets }
