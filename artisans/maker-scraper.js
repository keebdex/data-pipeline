require('dotenv').config()

const fs = require('fs')
const files = fs.readdirSync('./artisans/makers')
const Promise = require('bluebird')
const {
    makeImageId,
    updateMakerDatabase,
    setDryRun,
} = require('./utils/database')
const { uploadImage, getListImages } = require('../utils/image')

/**
 * List of makers that are known to have incomplete data
 * and should not have missing items removed from the database
 */
const PARTIAL_MAKERS = new Set(['keycat'])

// Check for dry-run flag from command line arguments
const isDryRun = process.argv.includes('--dry-run')
if (isDryRun) {
    console.log(
        '🔄 DRY RUN MODE - Database operations will be logged but not executed',
    )
    setDryRun(true)
}

let existedImages = []

const DELIVERY_BASE_URL = `https://imagedelivery.net/${process.env.CF_IMAGES_ACCOUNT_HASH}`

const normalizeColorwayImage = (colorway) => {
    if (!colorway.img || colorway.img.includes(DELIVERY_BASE_URL)) {
        return colorway
    }

    return {
        ...colorway,
        remote_img: colorway.img,
        img: `${DELIVERY_BASE_URL}/${makeImageId(colorway)}/public`,
    }
}

const normalizeTables = (tables) =>
    tables.map((table) => {
        const colorways = table.colorways.map(normalizeColorwayImage)

        return {
            ...table,
            img: colorways[0]?.img || table.img || null,
            colorways,
        }
    })

const syncImages = async (colorways) => {
    const images = colorways
        .filter((colorway) => colorway.remote_img)
        .map((colorway) => [makeImageId(colorway), colorway.remote_img])
        .filter(([filename]) => !existedImages.includes(filename))

    if (!images.length) {
        return
    }

    console.log('syncing images', images.length)

    await Promise.map(
        images,
        async ([filename, url]) => {
            await uploadImage(filename, url)
            existedImages.push(filename)
        },
        { concurrency: 5 },
    )
}

function scan(filename) {
    console.log(`🚀 Running specific maker scraper: ${filename}...`)

    const { scraper } = require(`./makers/${filename}`)
    const maker_id = filename.replace(/\.js$/, '')

    return scraper()
        .then(normalizeTables)
        .then((tables) =>
            updateMakerDatabase(tables, {
                preserve_missing: PARTIAL_MAKERS.has(maker_id),
            }),
        )
        .then(async ({ colorways }) => {
            await syncImages(colorways)
        })
        .catch((error) => {
            console.error(`Error processing maker ${maker_id}:`, error)
        })
}

getListImages().then(async (images) => {
    existedImages = images

    await Promise.map(files, scan, { concurrency: 1 })
})
