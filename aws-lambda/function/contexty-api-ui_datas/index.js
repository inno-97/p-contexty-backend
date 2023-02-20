const pg = require('pg');

const pool = new pg.Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: process.env.DB_PORT,
});

const limit = 15;
function defaultRandomQuery(did = '') {
	const value = [];
	let num = 1;
	const query = `
	select 
	  d.did,
	  d.copyCount,
	  d.text,
	  d.image,
	  max(d.timestamp) as timestamp,
	  array_to_json(array_agg(ct))
	from (
	  select cud.did, cud.copyCount, cud.image, cudt.text, cud.timestamp from ct_ui_data cud 
	  inner join ct_ui_data_text cudt on cud.deploy = true and cud.did = cudt.did ${
			(did !== '' &&
				`where cud.did not in (
			${did
				.split(',')
				.map((item, idx) => {
					value.push(item);
					return `${idx !== 0 ? ',' : ''} $${num++}`;
				})
				.join('')}
	  )`) ||
			''
		}
	  order by random() limit $${num++}
	  ) as d
	inner join ct_rel_data_tag crdt on crdt.did = d.did 
	inner join ct_tag ct on ct.tid = crdt.tid
	group by d.did, d.copyCount, d.image, d.text
  `;

	value.push(limit);
	return {
		query: query,
		value: value,
	};
}

function defaultRandomTotalQuery() {
	const query = `
			select count(1) from ct_ui_data where deploy = true
		`;

	return {
		query: query,
		value: [],
	};
}

function conditionQuery(page = 0, q = '', f = []) {
	const value = [];

	let num = 1;

	if (q !== '') {
		value.push(`%${q}%`);
	}

	const query = `
	select 
	target.did, target.copyCount, target.image, target.text,
	max(target.timestamp) as timestamp,
	array_to_json(array_agg(ct))
  from (
	select cud.did, cud.copyCount, cud.image, cudt.text, cud.timestamp from ct_ui_data cud
	inner join ct_ui_data_text cudt on cud.deploy = true and cud.did = cudt.did
	where 1=1 ${(q !== '' && ` and cudt.text like $${num++}`) || ''} ${f
		.map((item) => {
			return `
	and exists (
		select 1 from ct_rel_data_tag tag
		where tag.did = cud.did
		and tag.tid in ( ${item
			.map((tid, idx) => {
				value.push(tid);
				return `${idx !== 0 ? ',' : ''} $${num++}`;
			})
			.join('')} )
	  )`;
		})
		.join('')}
	order by cud.copyCount desc, cud.timestamp desc, cud.did
	limit $${num++} offset $${num++} -- paging
  ) as target
	inner join ct_rel_data_tag crdt on target.did = crdt.did
	inner join ct_tag ct on crdt.tid = ct.tid
	group by target.did, target.copyCount, target.image, target.text
	order by target.copyCount desc, timestamp desc, target.did
	`;

	value.push(limit, page * limit);

	return {
		query: query,
		value: value,
	};
}

function conditionTotalQuery(q = '', f = []) {
	const value = [];
	let num = 1;

	if (q !== '') {
		value.push(`%${q}%`);
	}

	const query = `
	select count(1) from ct_ui_data cud
	inner join ct_ui_data_text cudt on cud.deploy = true and cud.did = cudt.did
	where 1=1 ${(q !== '' && ` and cudt.text like $${num++} `) || ''} ${f
		.map((item) => {
			return `and exists (
		select 1 from ct_rel_data_tag tag
		where tag.did = cud.did
		and tag.tid in ( ${item
			.map((tid, idx) => {
				value.push(tid);
				return `${idx !== 0 ? ',' : ''}$${num++}`;
			})
			.join('')} )
	  )`;
		})
		.join('')}
	`;

	return {
		query: query,
		value: value,
	};
}

function getTags(db_json) {
	const tags = { category: {}, service: {}, events: [] };

	for (let i = 0; i < db_json.length; i++) {
		const tagType = db_json[i].type;

		const data = {
			id: db_json[i].tid,
			name: db_json[i].name,
		};

		if (Array.isArray(tags[tagType + 's'])) {
			tags[tagType + 's'].push(data);
		} else {
			tags[tagType] = data;
		}
	}

	return tags;
}

exports.handler = async (event, context, callback) => {
	const { p = '', q = '', t = '', ri = '' } = event.queryStringParameters ?? {};
	// let default_mode = false;

	let res = {
		statusCode: 500,
	};

	let page = 0;
	if (p !== '0' && p !== '' && !isNaN(p)) {
		page = parseInt(p) - 1;
	}

	// if (q === '' && t === '') {
	// 	default_mode = true;
	// }

	let filterTags = [];
	if (t !== '') {
		const tagList = t.split(',');

		for (let tag of ['c:', 's:', 'e:']) {
			const value = tagList
				.filter((item) => item.slice(0, 2) === tag)
				.map((item) => item.slice(2));
			if (value.length !== 0) {
				filterTags.push(value);
			}
		}
	}

	const client = await pool.connect();

	try {
		let getQuery = null;
		let totalQuery = null;

		// if (default_mode) {
		// 	getQuery = defaultRandomQuery(ri);
		// 	totalQuery = defaultRandomTotalQuery();
		// } else {
		getQuery = conditionQuery(page, q, filterTags);
		totalQuery = conditionTotalQuery(q, filterTags);
		// }

		// select get data query
		const get_query_res = await client.query(getQuery.query, getQuery.value);
		const data = get_query_res.rows.map((item) => {
			return {
				id: item.did,
				copyCount: item.copycount,
				text: item.text,
				image: item.image,
				timestamp: item.timestamp.getTime(),
				tags: getTags(item.array_to_json),
			};
		});

		// select get total count query
		const total_query_res = await client.query(totalQuery.query, totalQuery.value);
		const totalCount = total_query_res.rows[0].count;
		const totalPage = Math.ceil(totalCount / limit);

		// TODO implement
		res = {
			statusCode: 200,
			body: JSON.stringify({
				datas: data,
				totalPage: totalPage,
				totalCount: totalCount,
			}),
		};
	} catch (e) {
		console.error(e);
	} finally {
		client.release();
	}

	return res;
};
