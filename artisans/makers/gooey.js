const axios = require('axios')
const { crc32 } = require('crc')
const { urlSlugify } = require('../../utils')
const { format, parse } = require('date-fns')

const maker_id = 'gooey-keys'

const normalizeDate = (text) => {
    try {
        return format(parse(text, 'MMMM yyyy', new Date()), 'MMM yyyy')
    } catch {
        return text
    }
}

const scraper = async () => {
    const { data } = await axios({
        method: 'get',
        url: 'https://gooey.link/keycap-archivist.json',
    })

    const sculpts = data.sculpts.map((sculpt) => {
        const sculpt_id = urlSlugify(sculpt.name)

        const colorways = sculpt.colorways.map((colorway, order) => {
            const { name, img, releaseDate } = colorway

            return {
                name,
                img,
                maker_id,
                sculpt_id,
                release: normalizeDate(releaseDate),
                sale_type: null,
                colorway_id: crc32(
                    `${maker_id}-${sculpt_id}-${urlSlugify(name)}-${order}`,
                ).toString(16),
                order,
                qty: null,
                photo_credit: null,
            }
        })

        return {
            name: sculpt.name,
            release: normalizeDate(sculpt.releaseDate),
            colorways,
            maker_id,
            sculpt_id,
            profile: null,
            cast: null,
            design: null,
        }
    })

    return sculpts
}

module.exports = { scraper }
