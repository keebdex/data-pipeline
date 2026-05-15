const axios = require('axios')
const { crc32 } = require('crc')
const cheerio = require('cheerio')
const { groupBy } = require('lodash')
const { urlSlugify } = require('../../utils')

const SHOP_URL = 'https://thekeycat.com/shop'
const VALID_SCULPTS = new Set([
    'Balo',
    'Beee',
    'Pipo',
    'Puffy',
    'Spaceship',
    'Tete',
    'Tony',
])

const SALE_FORMATS = new Map([
    ['RAFFLE', 'Raffle'],
    ['GROUPBUY', 'Fulfillment'],
])

const maker_id = 'keycat'

function parseTitle(title) {
    const parts = title.trim().split(/\s+/)
    if (parts.length === 0) {
        return null
    }

    const sculptCandidate = parts[parts.length - 1]
    if (!VALID_SCULPTS.has(sculptCandidate)) {
        return null
    }

    const colorway = parts.slice(0, -1).join(' ')
    if (!colorway) {
        return null
    }

    return { colorway, sculpt: sculptCandidate }
}

function toAbsoluteUrl(base, url) {
    try {
        return new URL(url, base).toString()
    } catch {
        return null
    }
}

function extractImage($container, baseUrl) {
    const img =
        $container.find('img.wp-post-image').first().get(0) ||
        $container.find('img').first().get(0)

    if (!img) return null

    const $img = $container.find(img)
    const srcset = $img.attr('data-srcset')
    const src = $img.attr('data-src')

    if (srcset) {
        const first = srcset.split(',').reverse()[0].trim().split(' ')[0]

        return toAbsoluteUrl(baseUrl, first)
    }

    if (src) return toAbsoluteUrl(baseUrl, src)

    return null
}

function extractSales(html, baseUrl = SHOP_URL) {
    const $ = cheerio.load(html)

    const items = []

    $('.product-small.col.has-hover').each((_, el) => {
        const $container = $(el)

        const $a = $container
            .find(
                'a.woocommerce-LoopProduct-link.woocommerce-loop-product__link',
            )
            .first()
        if ($a.length === 0) return

        const titleText =
            $a.text().trim() ||
            $container
                .find('.woocommerce-loop-product__title')
                .first()
                .text()
                .trim()

        const parsed = parseTitle(titleText)
        if (!parsed) return

        const img = extractImage($container, baseUrl)

        const badge = $container.find('.badge').first().text().trim() || null

        const sculpt_id = urlSlugify(parsed.sculpt)
        const colorway_key = `${maker_id}-${sculpt_id}-${urlSlugify(
            parsed.colorway,
        )}`

        items.push({
            name: parsed.colorway.trim(),
            img,
            maker_id,
            sculpt_id,
            sale_type: SALE_FORMATS.get(badge) || null,
            colorway_id: crc32(colorway_key).toString(16),
            // order: index,
            // stem,
        })
    })

    return items
}

const scraper = async () => {
    try {
        const html = await axios.get(SHOP_URL).then((res) => res.data)
        const sales = extractSales(html)

        const sculpts = groupBy(sales, 'sculpt_id')

        const tables = Object.entries(sculpts).map(
            ([sculpt_id, colorways]) => ({
                maker_id,
                sculpt_id,
                name: sculpt_id.charAt(0).toUpperCase() + sculpt_id.slice(1),
                img: colorways[0]?.img || null,
                colorways: colorways.reverse(),
            }),
        )

        return tables
    } catch (err) {
        console.error(err)
        process.exit(1)
    }
}

module.exports = { scraper }
