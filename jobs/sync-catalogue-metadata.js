require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const drive = require('@googleapis/drive')
const Promise = require('bluebird')
const { flattenDeep } = require('lodash')
const path = require('path')
const { ARTISAN_MAKERS_TABLE } = require('../utils')

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
)

const getActiveDocIds = () =>
    supabase
        .from(ARTISAN_MAKERS_TABLE)
        .select('id, document_ids')
        .neq('deleted', true)
        .then(({ data }) => data.filter((r) => Array.isArray(r.document_ids)))
        .then((makers) => {
            return flattenDeep(
                makers.map((m) =>
                    m.document_ids.map((doc_id) => ({
                        maker_id: m.id,
                        doc_id,
                    })),
                ),
            )
        })

const getExistedDocIds = () =>
    supabase
        .from('raw_document_metadata')
        .select('doc_id')
        .then(({ data }) => data.map((r) => r.doc_id))

let existedIds = []

const syncMetadata = async ({ maker_id, doc_id }) => {
    const auth = new drive.auth.GoogleAuth({
        keyFile: path.join(__dirname, '..', '..', '/keebdex.json'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    })

    const { data } = await drive
        .drive({ version: 'v3', auth })
        .files.get({ fileId: doc_id, fields: '*' })

    const metadata = {
        doc_id: data.id,
        maker_id,
        title: data.name,
        owners: data.owners,
        created_at: data.createdTime,
        last_modified_at: data.modifiedTime,
        last_modifying_user: data.lastModifyingUser,
    }

    if (existedIds.includes(doc_id)) {
        await supabase
            .from('raw_document_metadata')
            .update(metadata)
            .eq('doc_id', doc_id)
    } else {
        await supabase.from('raw_document_metadata').insert(metadata)
    }
}

const startSync = async () => {
    existedIds = await getExistedDocIds()
    const activeDocIds = await getActiveDocIds()

    await Promise.map(activeDocIds, syncMetadata, { concurrency: 1 })
}

startSync()
