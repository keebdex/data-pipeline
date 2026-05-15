require('dotenv').config()

const { glob } = require('fs/promises')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

// Load adapters with priority order
async function loadAdapters() {
    const priorityMap = {
        NovelKeys: 1,
        ProtoTypist: 2,
    }

    const files = glob(path.join(__dirname, 'adapters/*.js'))

    let adapters = []
    for await (const file of files) {
        const adapter = require(file)

        const order = priorityMap[adapter.name] ?? 99
        adapters.push({ ...adapter, order })
    }

    adapters = await Promise.all(adapters)

    return adapters.sort((a, b) => a.order - b.order)
}

const syncKeysets = async () => {
    console.log('🚀 Starting Keyset Sync Script')

    const adapters = await loadAdapters()
    const allKeysets = new Map() // key: profile_keyset_id, value: { keyset, kits }

    for (const { name, fetchKeysets } of adapters) {
        console.log(`\n📦 Fetching from ${name}...`)

        try {
            const keysets = await fetchKeysets()

            for (const { keyset, kits } of keysets) {
                const id = keyset.profile_keyset_id

                // Skip if already added from higher priority adapter
                if (allKeysets.has(id)) continue

                allKeysets.set(id, { keyset, kits })
            }
        } catch (err) {
            console.error(`‼️ Failed to fetch from ${name}:`, err.message)
        }
    }

    console.log(`\n📊 Total unique keysets: ${allKeysets.size}`)

    // Insert into Supabase
    for (const { keyset, kits } of allKeysets.values()) {
        const { data: existing } = await supabase
            .from('keysets')
            .select('profile_keyset_id')
            .eq('profile_keyset_id', keyset.profile_keyset_id)
            .single()

        if (existing) {
            console.log(`🔁 ${keyset.name} already exists. Skipping.`)
            continue
        }

        const { error: keysetError } = await supabase
            .from('keysets')
            .insert([keyset])
        if (keysetError) {
            console.error(
                `‼️ Error inserting keyset: ${keyset.name}`,
                keysetError.message,
            )
            continue
        }

        if (kits.length > 0) {
            const { error: kitError } = await supabase
                .from('keyset_kits')
                .insert(kits)
            if (kitError) {
                console.error(
                    `‼️ Error inserting kits for ${keyset.profile_keyset_id}`,
                    kitError.message,
                )
            } else {
                console.log(
                    `✅ Inserted ${kits.length} kits for ${keyset.name}`,
                )
            }
        }
    }

    console.log('\n🎉 All vendors synced!')
}

syncKeysets()
