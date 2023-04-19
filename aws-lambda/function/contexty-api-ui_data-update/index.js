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
	const { did = null } = event.pathParameters ?? {};

	const bodyParser = await parser.parse(event);
	const imageFile = bodyParser.files[0];
	const data = JSON.parse(bodyParser.data);

	if (parseInt(did) !== data.id) {
		return {
			statusCode: 403,
		};
	}

	const state = { validation: false, update: false, image: null };
	state.validation = validationData(data);
	if (state.validation !== true) {
		return {
			statusCode: 200,
			body: JSON.stringify(state),
		};
	}

	const client = await pool.connect();
	try {
		const stored = await getData(client, data.id);
		console.log(data);
		console.log(stored);

		data.image = `${data.tags.service.name}/${data.image.substr(data.image.indexOf('/') + 1)}`;
		if (data.image !== stored.image) {
			state.image = false;
			if (await existsImage(client, data.id, data.image)) {
				state.image = 'exists';
				return {
					statusCode: 200,
					body: JSON.stringify(state),
				};
			}

			const upImageSuccess = await updateImage(client, data.id, data.image);
			if (upImageSuccess === false) {
				return {
					statusCode: 200,
					body: JSON.stringify(state),
				};
			}

			// service tag check
			if (data.tags.service.id !== stored.tags.service.id) {
				const upTagsSuccess = await updateTags(
					client,
					data.id,
					stored.tags.service.id,
					data.tags.service.id
				);

				if (upTagsSuccess === false) {
					await updateImage(client, data.id, stored.image);
					return {
						statusCode: 200,
						body: JSON.stringify(state),
					};
				}
			}

			if (imageFile === undefined) {
				const copyParams = {
					Bucket: AWS_BUCKET,
					Key: `${rootPath}/${data.image}`,
					CopySource: encodeURIComponent(`${AWS_BUCKET}/${rootPath}/${stored.image}`),
				};
				await s3.copyObject(copyParams).promise();
			} else {
				const buffer = imageFile.content;
				const fileFullName = `${rootPath}/${data.image}`;

				const uploadParams = {
					Bucket: AWS_BUCKET,
					Key: fileFullName,
					Body: buffer,
				};

				await s3.upload(uploadParams).promise();
			}

			const deleteParams = {
				Bucket: AWS_BUCKET,
				Key: `${rootPath}/${stored.image}`,
			};
			await s3.deleteObject(deleteParams).promise();

			state.image = true;
			state.update = true;
		}

		// category tag check
		if (data.tags.category.id !== stored.tags.category.id) {
			state.update = true;
			await updateTags(client, data.id, stored.tags.category.id, data.tags.category.id);
		}

		const delTags = [];
		const addTags = [...data.tags.events];
		// event tags check
		for (let i = 0; i < stored.tags.events.length; i++) {
			const st = stored.tags.events[i];

			let match = false;
			for (let j = 0; j < addTags.length; j++) {
				const nt = addTags[j];

				if (st.id === nt.id) {
					match = true;
					addTags.splice(j, 1);
					break;
				}
			}

			if (match === false) {
				delTags.push(st);
			}
		}

		if (delTags.length !== 0 || addTags.length !== 0) {
			state.update = true;
			await insertTags(client, data.id, addTags);
			await deleteTags(client, data.id, delTags);
		}

		// text check
		if (data.text !== stored.text) {
			state.update = true;
			await updateText(client, data.id, data.text);
		}
	} catch (e) {
		console.log('error!!', e);
		state.update = false;
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

function getTags(db_json) {
	const tags = { category: {}, service: {}, events: [] };

	for (let i = 0; i < db_json.length; i++) {
		const tagType = db_json[i].type;

		const data = {
			id: db_json[i].tid,
			name: db_json[i].name,
			type: db_json[i].type,
		};

		if (Array.isArray(tags[tagType + 's'])) {
			tags[tagType + 's'].push(data);
		} else {
			tags[tagType] = data;
		}
	}

	return tags;
}

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
				tags: getTags(ui_data.array_to_json),
			};
		} catch (e) {
			console.error(e);
		}
	}
}

async function existsImage(client, did, image) {
	try {
		const query = `
		select image from ct_ui_data where image = $1 and did != $2
		`;

		// select get data query
		const query_res = await client.query(query, [image, did]);

		return query_res.rowCount !== 0;
	} catch (e) {
		console.log(e);
		throw 'existsImage Error';
	}
}

async function updateText(client, did, text) {
	try {
		const query = `
		update ct_ui_data_text set text = $1 where did = $2 RETURNING *;
		`;

		const query_res = await client.query(query, [text, did]);

		if (query_res.rowCount === 0) {
			console.log(`update UIText Failed: did(${did})`);
		}

		return query_res.rowCount !== 0;
	} catch (e) {
		console.log(e);
		throw `updateText Error did(${did})`;
	}
}

async function updateImage(client, did, image) {
	try {
		const query = `
		update ct_ui_data set image = $1 where did = $2 RETURNING *;
		`;

		const query_res = await client.query(query, [image, did]);

		if (query_res.rowCount === 0) {
			console.log(`update UIData Image Failed: did(${did})`);
		}

		return query_res.rowCount !== 0;
	} catch (e) {
		console.log(e);
		throw `updateImage Error did(${did})`;
	}
}

async function updateTags(client, did, oldTag, newTag) {
	try {
		const query = `
		update ct_rel_data_tag set tid = $1 where did = $2 and tid = $3 RETURNING *;
		`;

		const query_res = await client.query(query, [newTag, did, oldTag]);

		if (query_res.rowCount === 0) {
			console.log(`update Tag Failed: did(${did}) old(${oldTag}) new(${newTag})`);
		}

		return query_res.rowCount !== 0;
	} catch (e) {
		console.log(e);
		throw `updateTags Error did(${did})`;
	}
}

async function insertTags(client, did, tags) {
	const insert_ui_tag_rel = 'INSERT INTO ct_rel_data_tag (did, tid) VALUES($1, $2) RETURNING *';

	for (let i = 0; i < tags.length; i++) {
		const tid = parseInt(tags[i].id);
		try {
			const res = await client.query(insert_ui_tag_rel, [did, tid]);
		} catch (err) {
			console.log('insertTags ERROR', err);
			throw err;
		}
	}

	return true;
}

async function deleteTags(client, did, tags) {
	const delete_rel_data_tag = 'DELETE FROM ct_rel_data_tag where did = $1 and tid = $2';

	for (let i = 0; i < tags.length; i++) {
		const tid = parseInt(tags[i].id);

		try {
			const rs = await client.query(delete_rel_data_tag, [did, tid]);
		} catch (err) {
			console.log('deleteTags ERROR', err);
			throw err;
		}
	}

	return true;
}
