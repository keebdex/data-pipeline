require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const Promise = require('bluebird')
const { uploadImage } = require('../utils/image')
const { urlSlugify } = require('../utils')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

const DELIVERY_BASE_URL = `https://imagedelivery.net/${process.env.CF_IMAGES_ACCOUNT_HASH}`

const makeKeysetImageId = (k) => `keyset/${k.profile_keyset_id}`
const makeKeysetKitImageId = (k) =>
    `keyset/${k.profile_keyset_id}/kit/${k.id}/${k.kit_id || urlSlugify(k.name)}`
const makeKeyboardImageId = (k) =>
    `keyboard/${k.brand_keyboard_slug}/${k.release_id}/${urlSlugify(k.variant_name)}`

const getKeysets = async (rows = []) => {
    const { data } = await supabase
        .from('keysets')
        .select('img, profile_keyset_id')
        .not('img', 'is', null)
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
        .select('*')
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
        .select('*')
        .not('img_front', 'is', null)
        .neq('img_front', '')
        .not('img_back', 'is', null)
        .neq('img_back', '')
        .order('id')
        .range(rows.length, rows.length + 999)

    rows = rows.concat(data)

    if (data.length === 1000) {
        return getKeyboardVariants(rows)
    }

    return rows
}

const syncNewKeyset = async (keyset) => {
    const filename = makeKeysetImageId(keyset)

    const promise = supabase
        .from('keysets')
        .update({
            img: `${DELIVERY_BASE_URL}/keyset/${keyset.profile_keyset_id}/public`,
        })
        .eq('profile_keyset_id', keyset.profile_keyset_id)

    const { ok, status } = await uploadImage(filename, keyset.img, promise)

    if (!ok && status === 404) {
        const { error } = await supabase
            .from('keysets')
            .update({ img: null })
            .eq('profile_keyset_id', keyset.profile_keyset_id)

        if (error) {
            console.error(
                `Failed to remove image url for keyset ${keyset.profile_keyset_id}`,
                error,
            )
        }
    }
}

const syncNewKeysetKit = async (kit) => {
    const filename = makeKeysetKitImageId(kit)

    const promise = supabase
        .from('keyset_kits')
        .update({
            img: `${DELIVERY_BASE_URL}/${filename}/public`,
        })
        .eq('id', kit.id)

    const { ok, status } = await uploadImage(filename, kit.img, promise)

    if (!ok && status === 404) {
        const { error } = await supabase
            .from('keyset_kits')
            .update({ img: '' })
            .eq('id', kit.id)

        if (error) {
            console.error(
                `Failed to remove image url for keyset kit ${kit.id}`,
                error,
            )
        }
    }
}

const syncNewKeyboardVariant = async (variant) => {
    const filename = makeKeyboardImageId(variant)

    if (variant.img_front && !variant.img_front.includes(DELIVERY_BASE_URL)) {
        const promiseFront = supabase
            .from('keyboard_variants')
            .update({
                img_front: `${DELIVERY_BASE_URL}/${filename}/front/public`,
            })
            .eq('id', variant.id)
        await uploadImage(`${filename}/front`, variant.img_front, promiseFront)
    }

    if (variant.img_back && !variant.img_back.includes(DELIVERY_BASE_URL)) {
        const promiseBack = supabase
            .from('keyboard_variants')
            .update({
                img_back: `${DELIVERY_BASE_URL}/${filename}/back/public`,
            })
            .eq('id', variant.id)
        await uploadImage(`${filename}/back`, variant.img_back, promiseBack)
    }
}

Promise.all([getKeysets(), getKeysetKits(), getKeyboardVariants()])
    .then(async ([keysets, kits, variants]) => {
        const unsyncedKeysets = keysets.filter(
            (keyset) => keyset.img && !keyset.img.includes(DELIVERY_BASE_URL),
        )

        const unsyncedKits = kits.filter(
            (kit) => kit.img && !kit.img.includes(DELIVERY_BASE_URL),
        )

        const unsyncedVariants = variants.filter(
            (variant) =>
                (variant.img_front &&
                    !variant.img_front.includes(DELIVERY_BASE_URL)) ||
                (variant.img_back &&
                    !variant.img_back.includes(DELIVERY_BASE_URL)),
        )

        console.log('keysets to sync', unsyncedKeysets.length)
        console.log('keyset kits to sync', unsyncedKits.length)
        console.log('keyboard variants to sync', unsyncedVariants.length)

        if (unsyncedKeysets.length) {
            await Promise.map(unsyncedKeysets, syncNewKeyset, {
                concurrency: 5,
            })
        }

        if (unsyncedKits.length) {
            await Promise.map(unsyncedKits, syncNewKeysetKit, {
                concurrency: 5,
            })
        }

        if (unsyncedVariants.length) {
            await Promise.map(unsyncedVariants, syncNewKeyboardVariant, {
                concurrency: 5,
            })
        }
    })
    .catch(console.error)
