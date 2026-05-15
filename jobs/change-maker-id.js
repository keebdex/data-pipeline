require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const {
    ARTISAN_MAKERS_TABLE,
    ARTISAN_SCULPTS_TABLE,
    ARTISAN_COLORWAYS_TABLE,
} = require('../utils')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

const [_node, _path, old_maker_id, new_maker_id] = process.argv

async function changeMakerId() {
    const { data: maker } = await supabase
        .from(ARTISAN_MAKERS_TABLE)
        .select()
        .eq('id', old_maker_id)
        .single()

    // insert new_maker_id row for changing maker_id since it's foreign key
    await supabase.from(ARTISAN_MAKERS_TABLE).insert({
        ...maker,
        id: new_maker_id,
    })

    await supabase
        .from(ARTISAN_SCULPTS_TABLE)
        .update({
            maker_id: new_maker_id,
        })
        .eq('maker_id', old_maker_id)
        .then(console.log('sculpts updated'))
        .catch((err) => {
            console.error('err', err.message)
        })

    await supabase
        .from(ARTISAN_COLORWAYS_TABLE)
        .update({
            maker_id: new_maker_id,
        })
        .eq('maker_id', old_maker_id)
        .then(console.log('colorways updated'))
        .catch((err) => {
            console.error('err', err.message)
        })

    await supabase
        .from(ARTISAN_MAKERS_TABLE)
        .delete()
        .eq('id', old_maker_id)
        .then(console.log('old_maker_id deleted'))
        .catch((err) => {
            console.error('err', err.message)
        })

    /**
     * after that, i think we need to run the scanner again to update img url
     */
}

changeMakerId()
