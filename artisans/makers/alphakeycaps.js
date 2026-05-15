const { crc32 } = require('crc')
const axios = require('axios')
const cheerio = require('cheerio')
const { findLast } = require('lodash')
const { urlSlugify } = require('../../utils')

const baseUrl = 'https://alphakeycaps.com'
const maker_id = 'alpha-keycaps'

const topre = '(T)'

const sculptScraper = async (sculpt_id, sculpt_name) => {
    const { data } = await axios({
        method: 'get',
        url: `${baseUrl}/${sculpt_id}`,
    })

    const $ = cheerio.load(data)

    const nodes = $('figure')

    return nodes
        .map((index, element) => {
            const node = $(element)
            const text = node.find('strong').text()
            const img = node.find('img').attr('data-src')

            let name = text.replace(sculpt_name, '')
            let stem = null

            if (name.includes(topre)) {
                stem = ['Topre']
                name = name.replace(topre, '')
            }

            const colorway_key = Array.isArray(stem)
                ? `${maker_id}-${sculpt_id}-${urlSlugify(name)}-${stem.join('|')}`
                : `${maker_id}-${sculpt_id}-${urlSlugify(name)}`

            return {
                name: name.trim(),
                img,
                maker_id,
                sculpt_id,
                sale_type: null,
                colorway_id: crc32(colorway_key).toString(16),
                order: index,
                stem,
            }
        })
        .get()
}

const catalogs = [
    'Darth Looga',
    'MF Belooga',
    'Keypora',
    'Jedi Blinker',
    'Blinker',
    'Matapora',
    'Alpha Ape',
    'Cherep',
    'Salvador',
    'Albison',
    'Mr Worldwide',
    'Boosted Gamer Set',
    'Geekpora',
    'Prayge',
    'Devoura',
    'Lickely',
    'Tut',
    'Tutré',
    'Pintut',
    'Kerebro',
]

const scraper = async () => {
    const sculpts = await Promise.all(
        catalogs.map(async (name) => {
            const sculpt_id = urlSlugify(name)
            const colorways = await sculptScraper(sculpt_id, name)

            return {
                name,
                maker_id,
                sculpt_id,
                colorways,
                img: findLast(colorways).img,
            }
        }),
    )

    return sculpts
}

module.exports = { scraper }
