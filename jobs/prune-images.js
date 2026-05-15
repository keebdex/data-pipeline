require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const Promise = require('bluebird')
const { difference, flattenDeep } = require('lodash')
const { getListImages, deleteImage } = require('../utils/image')
const { ARTISAN_COLORWAYS_TABLE } = require('../utils')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

const scrapers = ['alpha-keycaps', 'gooey-keys']

const normalizeImagePath = (url = '') =>
    url
        .replace('/public', '')
        .replace(
            `https://imagedelivery.net/${process.env.CF_IMAGES_ACCOUNT_HASH}/`,
            '',
        )

const getColorways = async (rows = []) => {
    const { data } = await supabase
        .from(ARTISAN_COLORWAYS_TABLE)
        .select('img')
        .not('maker_id', 'in', `(${scrapers.join()})`)
        .neq('img', '')
        .order('id')
        .range(rows.length, rows.length + 999)

    rows = rows.concat(data)

    if (data.length === 1000) {
        return getColorways(rows)
    }

    return rows
}

const getKeysets = async (rows = []) => {
    const { data } = await supabase
        .from('keysets')
        .select('img')
        .neq('img', '')
        .order('id')
        .range(rows.length, rows.length + 999)

    rows = rows.concat(data)

    if (data.length === 1000) {
        return getKeysets(rows)
    }

    return rows
}

const getKeysetKits = async (rows = []) => {
    const { data } = await supabase
        .from('keyset_kits')
        .select('img')
        .not('img', 'is', null)
        .neq('img', '')
        .order('id')
        .range(rows.length, rows.length + 999)

    rows = rows.concat(data)

    if (data.length === 1000) {
        return getKeysetKits(rows)
    }

    return rows
}

const getKeyboardVariants = async (rows = []) => {
    const { data } = await supabase
        .from('keyboard_variants')
        .select('image_url')
        .not('image_url', 'is', null)
        .neq('image_url', '')
        .order('id')
        .range(rows.length, rows.length + 999)

    rows = rows.concat(data)

    if (data.length === 1000) {
        return getKeyboardVariants(rows)
    }

    return rows
}

Promise.all([
    getColorways(),
    getKeysets(),
    getKeysetKits(),
    getKeyboardVariants(),
])
    .then(flattenDeep)
    .then(async (rows) => {
        const dbImages = rows
            .map((row) => row.img || row.image_url)
            .filter(Boolean)
            .map(normalizeImagePath)

        const remoteImages = await getListImages()

        const diff = difference(remoteImages, dbImages)

        console.log('db images', dbImages.length)
        console.log('remote images', remoteImages.length)
        console.log('prune images', diff.length, diff)

        return Promise.map(diff, deleteImage, { concurrency: 5 })
    })
    .catch(console.error)
