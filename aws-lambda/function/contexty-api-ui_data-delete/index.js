const AWS = require('aws-sdk');
const pg = require('pg');

AWS.config.update({
	region: 'ap-northeast-2',
});

const s3 = new AWS.S3();
const AWS_BUCKET = 'contexty-s3';
const rootPath = 'image/ui-data';

const pool = new pg.Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: process.env.DB_PORT,
});

exports.handler = async (event) => {
	const { did = null } = event.pathParameters ?? {};

	if (did === null) {
		return {
			statusCode: 403,
		};
	}

	const state = { delete: false, image: false };

	const client = await pool.connect();
	try {
		const stored = await getData(client, did);
		console.log(stored);

		if ((await deleteRelDataTag(client, did)) === false) {
			return {
				statusCode: 200,
				body: JSON.stringify(state),
			};
		}

		if ((await deleteUIDataText(client, did)) === false) {
			await addRelDataTag(client, did, stored.tags);

			return {
				statusCode: 200,
				body: JSON.stringify(state),
			};
		}

		if ((await deleteUIData(client, did)) === false) {
			await addRelDataTag(client, did, stored.tags);
			await addUIDataText(client, did, stored.text);

			return {
				statusCode: 200,
				body: JSON.stringify(state),
			};
		}

		const deleteParams = {
			Bucket: AWS_BUCKET,
			Key: `${rootPath}/${stored.image}`,
		};
		await s3.deleteObject(deleteParams).promise();

		state.delete = true;
		state.image = true;
	} catch (e) {
		console.log('error!!', e);
		state.error = true;
		return {
			statusCode: 200,
			body: JSON.stringify(state),
		};
	} finally {
		client.release();
	}

	// TODO implement
	const response = {
		statusCode: 200,
		body: JSON.stringify(state),
	};
	return response;
};

async function getData(client, did) {
	if (did === '' || did === null || isNaN(did)) {
		return null;
	} else {
		const query = `
		select cud.did, cudt.text, cud.image, cud.copycount, cud.timestamp,
			(select array_to_json(array_agg(ct)) from ct_tag ct
			inner join ct_rel_data_tag crdt on crdt.did = $1 and ct.tid = crdt.tid)
		from ct_ui_data cud 
			inner join ct_ui_data_text cudt on cud.did = cudt.did
			where cud.did = $1;
		`;

		try {
			// select get data query
			const get_query_res = await client.query(query, [did]);

			const ui_data = get_query_res.rows[0];

			if (ui_data === undefined) {
				return null;
			}

			return {
				id: ui_data.did,
				image: ui_data.image,
				copyCount: ui_data.copycount,
				text: ui_data.text,
				timestamp: ui_data.timestamp.getTime(),
				tags: ui_data.array_to_json,
			};
		} catch (e) {
			console.error(e);
		}
	}
}

// INSERT
async function addUIDataText(client, did, text) {
	const insert_ui_data_text =
		'INSERT INTO ct_ui_data_text (did, text) VALUES($1, $2) RETURNING *';
	try {
		const res = await client.query(insert_ui_data_text, [did, text]);
		return true;
	} catch (err) {
		console.log('INSERT CT_UI_DATA_TEXT ERROR', err);
		throw err;
	}
}

async function addRelDataTag(client, did, tags) {
	const insert_ui_tag_rel = 'INSERT INTO ct_rel_data_tag (did, tid) VALUES($1, $2) RETURNING *';

	for (let i = 0; i < tags.length; i++) {
		const tid = tags[i].tid;
		try {
			const res = await client.query(insert_ui_tag_rel, [did, tid]);
		} catch (err) {
			console.log('INSERT CT_REL_DATA_TAG ERROR', err);
			throw err;
		}
	}

	return true;
}

// DELETE
async function deleteRelDataTag(client, did) {
	const delete_rel_data_tag = 'DELETE FROM ct_rel_data_tag where did = $1';

	try {
		const rs = await client.query(delete_rel_data_tag, [parseInt(did)]);
		return true;
	} catch (err) {
		console.log('DELETE CT_REL_DATA_TAG ERROR', err);
		return false;
	}
}

async function deleteUIDataText(client, did) {
	const delete_ui_data_text = 'DELETE FROM ct_ui_data_text where did = $1';

	try {
		const rs = await client.query(delete_ui_data_text, [parseInt(did)]);
		return true;
	} catch (err) {
		console.log('DELETE CT_UI_DATA_TEXT ERROR', err);
		return false;
	}
}

async function deleteUIData(client, did) {
	const delete_ui_data = 'DELETE FROM ct_ui_data where did = $1';

	try {
		const rs = await client.query(delete_ui_data, [parseInt(did)]);
		return true;
	} catch (err) {
		console.log('DELETE CT_UI_DATA ERROR', err);
		return false;
	}
}
