require('dotenv').config()

const Promise = require('bluebird')
const deepmerge = require('deepmerge')
const {
    getGDocMakers,
    makeImageId,
    updateMakerDatabase,
    updateMetadata,
    setDryRun,
} = require('./utils/database')
const { downloadDoc, getFile, getRevisions } = require('./utils/docs')
const { uploadImage, getListImages } = require('../utils/image')
const { parser } = require('./utils/parser')
const { findLast, uniqBy } = require('lodash')

// Check for dry-run flag from command line arguments
const isDryRun = process.argv.includes('--dry-run')
if (isDryRun) {
    console.log(
        '🔄 DRY RUN MODE - Database operations will be logged but not executed',
    )
    setDryRun(true)
}

let existedImages = []

function customMerge(key) {
    if (key === 'colorways') {
        /**
         * this custom function to keep the colorway order is continuing
         * but the order for colorways from the second doc will be changed
         * if the maintainer added new colorways into the end of the first doc
         */
        return (prev, curr) => {
            const length = prev.length
            curr.forEach((c) => {
                c.order = c.order + length + 1
            })

            return prev.concat(curr)
        }
    }
}

async function scan(maker) {
    console.log('start downloading:', maker.id)

    const { id, document_ids } = maker
    let contributors = maker.contributors || []

    try {
        // download each doc independently so one failure doesn't sink the
        // rest (bluebird's Promise, hence .reflect() over allSettled)
        const inspections = await Promise.map(document_ids, (docId) =>
            Promise.resolve(downloadDoc(docId)).reflect(),
        )

        const availableDocumentIds = []
        const files = []
        let hasMissingDoc = false

        inspections.forEach((inspection, idx) => {
            if (inspection.isFulfilled()) {
                files.push(inspection.value())
                availableDocumentIds.push(document_ids[idx])

                return
            }

            const reason = inspection.reason()

            if (reason?.code === 404) {
                // doc was deleted - skip it, keep syncing the rest
                hasMissingDoc = true

                console.warn(
                    `doc ${document_ids[idx]} not found (404) for maker "${id}", skipping it`,
                )
            } else {
                // unexpected error - bail out, outer catch logs it
                throw reason
            }
        })

        if (!files.length) {
            // every doc for this maker is gone
            await updateMetadata(id, {
                disable_google_sync: true,
                deleted: true,
            })

            console.log(
                `maker "${id}" Google Doc not found (404) — disabled google sync and marked as deleted`,
            )

            return
        }

        const multi = files.length > 1

        const documents = files.map((file, idx) => {
            const parsed = parser(file, id)
            const source_document_id = availableDocumentIds[idx]

            // tag each sculpt/colorway with the doc it came from
            Object.values(parsed).forEach((sculpt) => {
                sculpt.source_document_id = source_document_id
                ;(sculpt.colorways || []).forEach((colorway) => {
                    colorway.source_document_id = source_document_id
                })
            })

            return parsed
        })
        const catalogue = multi
            ? deepmerge.all(documents, { customMerge })
            : documents[0]

        const database = Object.values(catalogue)

        // partial sync: don't delete rows that just belong to a missing doc
        const { modified, colorways } = await updateMakerDatabase(database, {
            preserve_missing: hasMissingDoc,
            available_document_ids: availableDocumentIds,
        })

        if (modified) {
            const fileId = findLast(availableDocumentIds)
            const file = await getFile(fileId)

            if (file?.capabilities?.canReadRevisions) {
                let revisions = await getRevisions(fileId)
                revisions = uniqBy(
                    revisions,
                    (r) => r?.lastModifyingUser?.permissionId,
                )

                revisions.forEach((revision) => {
                    contributors.push({
                        name: revision.lastModifyingUser.displayName,
                        picture: revision.lastModifyingUser.photoLink,
                        pid: revision.lastModifyingUser.permissionId,
                    })
                })
            } else if (file.lastModifyingUser) {
                contributors.push({
                    name: file.lastModifyingUser.displayName,
                    picture: file.lastModifyingUser.photoLink,
                    pid: file.lastModifyingUser.permissionId,
                })
            }

            contributors = uniqBy(contributors, 'pid')

            await updateMetadata(id, {
                contributors,
                updated_at: file.modifiedTime,
            })
        }

        const images = []
        colorways.map((clw) => {
            const filename = makeImageId(clw)
            if (!clw.img_overridden && !existedImages.includes(filename)) {
                images.push([filename, clw.remote_img])
            }
        })

        if (images.length && !isDryRun) {
            console.log('syncing images', images.length)

            await Promise.map(images, (img) => uploadImage(...img), {
                concurrency: 5,
            })
        } else if (images.length) {
            console.log(`[DRY RUN] Would sync ${images.length} images`)
        }
    } catch (error) {
        console.error(
            'catalogue deleted or sth went wrong',
            id,
            error?.stack || error,
        )

        if (error?.code === 404) {
            await updateMetadata(id, {
                disable_google_sync: true,
                deleted: true,
            })

            console.log(
                `maker "${id}" Google Doc not found (404) — disabled google sync and marked as deleted`,
            )
        }
    }
}

getGDocMakers().then(async (makers) => {
    console.log('🚀 Starting Google Docs import for artisans...')

    existedImages = await getListImages()

    makers = makers.filter(
        (m) => Array.isArray(m.document_ids) && m.document_ids.length,
    )

    console.log('existed images', existedImages.length)

    await Promise.map(makers, scan, { concurrency: 1 })
})
