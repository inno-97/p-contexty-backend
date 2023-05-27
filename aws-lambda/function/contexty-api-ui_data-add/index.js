const AWS = require('aws-sdk');
const pg = require('pg');

const parser = require('lambda-multipart-parser');

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
	const result = [];

	const uuid = event.requestContext.authorizer.lambda.uuid;

	const bodyParser = await parser.parse(event);
	const imageFiles = bodyParser.files;
	const datas = bodyParser?.datas === undefined ? [] : JSON.parse(bodyParser.datas);

	// const deploy = true

	/**
	 * 우선 Deploy 기준으로 먼저
	 */
	// {validation: boolean, image: 'undefined' | 'exists' | null, create: boolean, error: Error}
	const client = await pool.connect();

	for (let i = 0; i < datas.length; i++) {
		const state = { validation: false, create: null, image: null };
		result.push(state);

		const data = datas[i];

		state.validation = validationData(data);
		if (state.validation !== true) {
			continue;
		}

		let imageFile = null;
		for (let fi = 0; fi < imageFiles.length; fi++) {
			if (imageFiles[fi].filename === data.image) {
				imageFile = imageFiles[fi];
				imageFiles.splice(fi, 1);
				break;
			}
		}

		if (imageFile === null) {
			state.image = 'undefined';
			continue;
		}

		data.image = `${data.tags.service.name}/${data.image}`;
		try {
			state.image = (await existsImage(client, data.image)) ? 'exists' : true;
			if (state.image === 'exists') {
				continue;
			}
			const test = await addUIData(client, uuid, data);

			const buffer = imageFile.content;
			const fileFullName = `${rootPath}/${data.image}`;

			const uploadParams = {
				Bucket: AWS_BUCKET,
				Key: fileFullName,
				Body: buffer,
			};

			await s3.upload(uploadParams).promise();

			// create data
			state.create = test;
		} catch (e) {
			console.log('error!!', e);
			state.error = true;
		}
	}

	client.release();
	return {
		statusCode: 200,
		body: JSON.stringify(result),
	};
};

function validationData(data) {
	if (!data) {
		return 'No Data';
	}

	if (!data.text) {
		return 'Text is required';
	}

	if (!data.tags) {
		return 'Tags(category, service, events) is required';
	}

	if (!data.image) {
		return 'Image is required';
	}

	const tags = data.tags;
	if (!tags.category || !tags.service || !Array.isArray(tags.events)) {
		return 'Tags(category, service, events) is required';
	} else {
		// category & service tag check
		if (tags.category.type !== 'category' || tags.service.type !== 'service') {
			return 'Tag type is invalid';
		}

		// events tag check;
		if (tags.events.length === 0) {
			return 'Tags(events) is required';
		} else {
			for (let i = 0; i < tags.events.length; i++) {
				const tag = tags.events[i];
				if (tag.type !== 'event') {
					return 'Tag type is invalid';
				}
			}
		}
	}

	return true;
}

async function existsImage(client, image) {
	try {
		const query = `
		select image from ct_ui_data where image = $1
		`;

		// select get data query
		const query_res = await client.query(query, [image]);

		return query_res.rowCount !== 0;
	} catch (e) {
		console.log(e);
		throw 'existsImage Error';
	}
}

async function addUIData(client, uuid, data) {
	const insert_ui_data =
		'INSERT INTO ct_ui_data (image, deploy, uuid) VALUES($1, $2, $3) RETURNING *';

	try {
		const res = await client.query(insert_ui_data, [data.image, true, uuid]);

		if (res.rowCount === 0) {
			console.log('insert ui_data result is null');
			return false;
		}

		const ui_data = res.rows[0];
		const did = ui_data.did;

		let successText = false;
		console.log('SUCESS did:' + did);
		if (did !== null && did !== undefined) {
			try {
				if (await addUIDataText(client, did, data.text)) {
					successText = true;
				}

				const tags = [data.tags.category, data.tags.service, ...data.tags.events];

				await addRelDataTag(client, did, tags);
				return true;
			} catch (e) {
				// delete tag
				console.log('delete RelDataTag', did);
				await deleteRelDataTag(client, did);
				if (successText) {
					// delete textData
					console.log('delete UIDataText', did);
					await deleteUIDataText(client, did);
				}

				// delete data
				console.log('delete UIData', did);
				await deleteUIData(client, did);
				return false;
			}
		}

		return true;
	} catch (e) {
		console.log('INSERT CT_UI_DATA ERROR', e);
		return false;
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
		const tid = parseInt(tags[i].id);
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
