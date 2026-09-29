const slugify = require('slugify').default

const ARTISAN_MAKERS_TABLE = 'artisan_makers'
const ARTISAN_SCULPTS_TABLE = 'artisan_sculpts'
const ARTISAN_COLORWAYS_TABLE = 'artisan_colorways'

exports.urlSlugify = (text) => {
    text = text.replace(/[*+~.()'"!:@,/]/g, '')

    return slugify(text, { lower: true })
}

exports.ARTISAN_MAKERS_TABLE = ARTISAN_MAKERS_TABLE
exports.ARTISAN_SCULPTS_TABLE = ARTISAN_SCULPTS_TABLE
exports.ARTISAN_COLORWAYS_TABLE = ARTISAN_COLORWAYS_TABLE
exports.DELIVERY_BASE_URL = `https://imagedelivery.net/${process.env.CF_IMAGES_ACCOUNT_HASH}`

// List of makers that are known to have incomplete data
// and should not have missing items removed from the database
exports.PARTIAL_MAKERS = new Set(['keycat'])
