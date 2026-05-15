const { createClient } = require('@supabase/supabase-js')
const Promise = require('bluebird')
const { writeFileSync } = require('fs')
const { flatten, difference, map, keyBy, isEmpty, groupBy } = require('lodash')
const { deleteImage } = require('../../utils/image')
const {
    ARTISAN_MAKERS_TABLE,
    ARTISAN_SCULPTS_TABLE,
    ARTISAN_COLORWAYS_TABLE,
} = require('../../utils')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

const isDevelopment = process.env.NODE_ENV !== 'production'
let dryRun = false

const makeColorwayKey = (c, withOrder) => {
    const keys = [
        c.maker_id,
        c.sculpt_id,
        c.colorway_id,
        c.name,
        c.release,
        c.qty,
        c.photo_credit,
        c.img,
        c.stem && c.stem.sort().join('-'),
    ]

    if (withOrder) {
        keys.push(c.order)
    }

    return keys.join()
}

const makeKeyByColorwayId = (c) =>
    `${c.maker_id}-${c.sculpt_id}-${c.colorway_id}`
const makeKeyByName = (c) => `${c.maker_id}-${c.sculpt_id}-${c.name}`

const makeSculptKey = (s) => {
    return [
        s.maker_id,
        s.sculpt_id,
        s.release,
        s.profile,
        s.cast,
        s.design,
        s.img,
    ].join()
}

const makeImageId = (c) =>
    `artisan/${c.maker_id}/${c.sculpt_id}/${c.colorway_id}`

const makerSculptId = (s) => `${s.maker_id}/${s.sculpt_id}`

const getGDocMakers = () =>
    supabase
        .from(ARTISAN_MAKERS_TABLE)
        .select()
        .neq('deleted', true)
        .neq('disable_google_sync', true)
        .then(({ data }) => data.filter((r) => Array.isArray(r.document_ids)))

const getColorways = async (maker_id, rows = []) => {
    const { data, error } = await supabase
        .from(ARTISAN_COLORWAYS_TABLE)
        .select()
        .eq('maker_id', maker_id)
        .order('id')
        .range(rows.length, rows.length + 999)

    if (error) {
        console.warn(`get ${ARTISAN_COLORWAYS_TABLE} error`, maker_id, error)

        return rows
    }

    const batch = data || []

    rows = rows.concat(batch)

    if (batch.length === 1000) {
        return getColorways(maker_id, rows)
    }

    return rows
}

const getSculpts = async (maker_id) => {
    const { data, error } = await supabase
        .from(ARTISAN_SCULPTS_TABLE)
        .select('*, total_colorways:artisan_colorways(count)')
        .eq('maker_id', maker_id)

    if (error) {
        console.warn(`get ${ARTISAN_SCULPTS_TABLE} error`, maker_id, error)

        return []
    }

    return data || []
}

const insertRows = async (table, values) => {
    if (dryRun) {
        console.log(
            `[DRY RUN] Would insert ${values.length} rows into ${table}`,
        )

        return
    }

    const { error } = await supabase.from(table).insert(values)

    if (error) {
        console.warn(`insert new ${table} error`, error)
    }
}

const deleteRows = async (table, column, values) => {
    if (dryRun) {
        console.log(
            `[DRY RUN] Would delete ${values.length} rows from ${table}`,
        )

        return
    }

    const { error } = await supabase.from(table).delete().in(column, values)

    if (error) {
        console.warn(`delete old ${table} error`, error)
    }
}

const updateRow = async (table, id, values) => {
    if (dryRun) {
        console.log(`[DRY RUN] Would update ${table} row with id: ${id}`)

        return
    }

    const { error } = await supabase.from(table).update(values).eq('id', id)

    if (error) {
        console.warn(`update ${table} row error`, id, error)
    }
}

const updateSculpts = async (sculpts) => {
    const { data: storedSculpts } = await supabase
        .from(ARTISAN_SCULPTS_TABLE)
        .select()
        .eq('maker_id', sculpts[0].maker_id)

    const incomingKeys = sculpts.map(makeSculptKey)
    const existedKeys = storedSculpts.map(makeSculptKey)

    const newKeys = difference(incomingKeys, existedKeys)
    const changedKeys = difference(existedKeys, incomingKeys)

    const tobeInserted = sculpts.filter((s) =>
        newKeys.includes(makeSculptKey(s)),
    )
    const tobeUpdated = storedSculpts.filter((s) =>
        changedKeys.includes(makeSculptKey(s)),
    )

    const insertingMap = keyBy(tobeInserted, makerSculptId)

    const updateSculpt = {}
    const deletedSculpts = []

    /**
     * we dont know it's newly added sculpt or just sculpt name is changed
     * so we accept that and remove old ones
     */
    tobeUpdated.forEach((s) => {
        const key = makerSculptId(s)
        if (insertingMap[key]) {
            updateSculpt[s.id] = insertingMap[key]

            delete insertingMap[key]
        } else {
            deletedSculpts.push(s)
        }
    })

    const newSculpts = Object.values(insertingMap)

    if (newSculpts.length) {
        await insertRows(ARTISAN_SCULPTS_TABLE, newSculpts)

        console.log('sculpts inserted', newSculpts.length)
    }

    if (!isEmpty(updateSculpt)) {
        await Promise.map(
            Object.entries(updateSculpt),
            ([id, data]) => updateRow(ARTISAN_SCULPTS_TABLE, id, data),
            { concurrency: 1 },
        )

        console.log('sculpts updated', Object.entries(updateSculpt).length)
    }

    // maybe we need to remove colorways which is deleted sculpt
    if (deletedSculpts.length) {
        await deleteRows(
            ARTISAN_COLORWAYS_TABLE,
            'maker_sculpt_id',
            deletedSculpts.map(makerSculptId),
        )
        await deleteRows(
            ARTISAN_SCULPTS_TABLE,
            'id',
            deletedSculpts.map((s) => s.id),
        )

        console.log('sculpts deleted', deletedSculpts.length)
    }
}

const updateMakerDatabase = async (tables, options = {}) => {
    if (!tables.length) {
        return { modified: false, colorways: [] }
    }

    const { maker_id } = tables[0]
    const { preserve_missing = false } = options

    if (isDevelopment) {
        writeFileSync(
            `db/${maker_id}.json`,
            JSON.stringify(tables, null, 2),
            () => {
                console.log('done')
            },
        )
    }

    // update sculpts
    let sculpts = tables.map(({ colorways, ...rest }) => rest)
    const incomingColorways = flatten(map(tables, 'colorways'))
    const storedColorways = await getColorways(maker_id)

    if (preserve_missing) {
        const storedSculpts = await getSculpts(maker_id)
        const incomingSculptIds = sculpts.map((sculpt) => sculpt.sculpt_id)
        const existingColorwayKeys = incomingColorways.map((colorway) =>
            makeKeyByColorwayId(colorway),
        )

        sculpts = sculpts.concat(
            storedSculpts.filter(
                (sculpt) => !incomingSculptIds.includes(sculpt.sculpt_id),
            ),
        )

        const sculptLengthMap = Object.entries(
            groupBy(storedColorways, (s) => s.sculpt_id),
        ).reduce((prev, [sculpt_id, clws]) => {
            prev[sculpt_id] = clws.length

            return prev
        }, {})

        incomingColorways.forEach((colorway, idx) => {
            const length = sculptLengthMap[colorway.sculpt_id] || 0
            colorway.order = length + idx
        })

        incomingColorways.push(
            ...storedColorways.filter(
                (colorway) =>
                    !colorway.deleted &&
                    !existingColorwayKeys.includes(
                        makeKeyByColorwayId(colorway),
                    ),
            ),
        )
    }

    await updateSculpts(sculpts)

    // update colorways
    const colorways = incomingColorways

    const incomingKeys = colorways.map((c) => makeColorwayKey(c, true))
    const existedKeys = storedColorways.map((c) => makeColorwayKey(c, true))

    const newKeys = difference(incomingKeys, existedKeys)
    const changedKeys = difference(existedKeys, incomingKeys)

    const tobeInserted = colorways.filter((c) =>
        newKeys.includes(makeColorwayKey(c, true)),
    )
    const tobeUpdated = storedColorways.filter((c) =>
        changedKeys.includes(makeColorwayKey(c, true)),
    )

    const insertingMapByColorwayId = keyBy(tobeInserted, makeKeyByColorwayId)
    const insertingMapByName = keyBy(tobeInserted, makeKeyByName)

    const outdatedImages = []
    const updateClw = {}
    const deletedRows = []

    tobeUpdated.forEach((c) => {
        const keyByColorwayId = makeKeyByColorwayId(c)
        const keyByName = makeKeyByName(c)

        if (insertingMapByColorwayId[keyByColorwayId]) {
            // colorway_id/img not changed
            const { remote_img, ...rest } =
                insertingMapByColorwayId[keyByColorwayId]

            updateClw[`${c.id}__${c.colorway_id}`] = rest
            delete insertingMapByColorwayId[keyByColorwayId]
        } else if (insertingMapByName[keyByName]) {
            // name is same, colorway_id/img changed
            const { remote_img, ...rest } = insertingMapByName[keyByName]
            const newKey = makeKeyByColorwayId(rest)

            updateClw[`${c.id}__${c.colorway_id}`] = rest
            delete insertingMapByColorwayId[newKey]

            outdatedImages.push(makeImageId(c))
        } else {
            // colorway deleted, to be removed from the database
            outdatedImages.push(makeImageId(c))
            deletedRows.push(c.id)
        }
    })

    const insertClws = Object.values(insertingMapByColorwayId).map(
        ({ remote_img, ...rest }) => rest,
    )

    let modified = false

    if (insertClws.length) {
        modified = true
        await insertRows(ARTISAN_COLORWAYS_TABLE, insertClws)

        console.log('colorways inserted', insertClws.length)
    }

    if (!isEmpty(updateClw)) {
        modified = true

        await Promise.map(
            Object.entries(updateClw),
            async ([rowKey, data]) => {
                const [id] = rowKey.split('__')
                await updateRow(ARTISAN_COLORWAYS_TABLE, id, data)
            },
            { concurrency: 1 },
        )

        console.log('colorways updated', Object.entries(updateClw).length)
    }

    if (outdatedImages.length) {
        await Promise.map(outdatedImages, deleteImage, { concurrency: 10 })

        console.log('images pruned', outdatedImages.length)
    }

    if (deletedRows.length) {
        const outdatedItems = await supabase
            .from('user_collection_items')
            .select('artisan_item_id')
            .in('artisan_item_id', deletedRows)
            .then(({ data }) => data.map((r) => r.artisan_item_id))

        // marked for deletion are added to user collections for later removal
        await Promise.map(
            outdatedItems,
            async (id) => {
                await updateRow(ARTISAN_COLORWAYS_TABLE, id, { deleted: true })
            },
            { concurrency: 1 },
        )

        // deleting colorways does not add them to any collections
        await deleteRows(
            ARTISAN_COLORWAYS_TABLE,
            'id',
            deletedRows.filter((id) => !outdatedItems.includes(id)),
        )

        console.log('colorways deleted', outdatedImages.length)
    }

    return { modified, colorways }
}

const updateMetadata = async (id, data) => {
    if (dryRun) {
        console.log(`[DRY RUN] Would update maker metadata with id: ${id}`)

        return
    }

    const { error } = await supabase
        .from(ARTISAN_MAKERS_TABLE)
        .update(data)
        .eq('id', id)

    if (error) {
        console.warn('update maker error', id, error)
    }
}

module.exports = {
    getGDocMakers,
    makeImageId,
    updateMakerDatabase,
    updateMetadata,
    setDryRun(value) {
        dryRun = value
    },
}
