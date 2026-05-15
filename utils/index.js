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
