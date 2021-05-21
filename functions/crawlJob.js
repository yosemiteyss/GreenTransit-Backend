const { admin, db } = require('./config');
const axios = require('axios');
const geofire = require('geofire-common');
const { STOP_COLLECTION } = require('./constants');
const { ROUTES_COLLECTION } = require('./constants');
const { ROUTE_CODES_COLLECTION } = require('./constants');

const instance = axios.create({
  baseURL: 'https://data.etagmb.gov.hk',
  timeout: 540000,
});

const getCodes = async () => {
  const response = await instance.get('/route');

  const hkiCodes = response.data.data.routes.HKI.map(code => {
    return { code: code, region: 'HKI' };
  });

  const klnCodes = response.data.data.routes.KLN.map(code => {
    return { code: code, region: 'KLN' };
  });

  const ntCodes = response.data.data.routes.NT.map(code => {
    return { code: code, region: 'NT' };
  });

  return hkiCodes.concat(klnCodes, ntCodes);
};

const getRoutes = async (code, region) => {
  const response = await instance.get(`/route/${region}/${code}`);
  const routes = response.data.data;
  const results = [];

  routes.forEach((route) => {
    route.directions.forEach((direction) => {
      results.push({
        routeId: route.route_id,
        routeSeq: direction.route_seq,
        routeOrigTC: direction.orig_tc,
        routeOrigSC: direction.orig_sc,
        routeOrigEN: direction.orig_en,
        routeDestTC: direction.dest_tc,
        routeDestSC: direction.dest_sc,
        routeDestEN: direction.dest_en
      });
    });
  });

  return results;
};

const getStops = async (routeId, routeSeq) => {
  const response = await instance.get(`/route-stop/${routeId}/${routeSeq}`);
  const routeStops = response.data.data.route_stops;

  return routeStops.map((stop) => {
    return {
      stopId: stop.stop_id,
      stopSeq: stop.stop_seq
    };
  });
};

const getStopCoords = async (stopId) => {
  const response = await instance.get(`/stop/${stopId}`);
  return response.data.data.coordinates.wgs84;
};

const insertCodes = async (codes) => {
  const batch = db.batch();

  for (const code of codes) {
    const docId = `${code.code}_${code.region}`;
    const docRef = db.doc(`${ROUTE_CODES_COLLECTION}/${docId}`);

    batch.set(docRef, {
      code: code.code,
      region: code.region,
    });
  }

  await batch.commit();
};

const insertRoutes = async (code, region, routes) => {
  const batch = db.batch();
  const routeCodeDocRef = db.doc(`${ROUTE_CODES_COLLECTION}/${code}_${region}`);

  const routeIds = [];

  for (const route of routes) {
    routeIds.push(route.routeId);

    const routeDocRef = db.doc(
      `${ROUTE_CODES_COLLECTION}/${code}_${region}/${ROUTES_COLLECTION}/${route.routeId}`
    );

    await routeDocRef.set({
      route_id: route.routeId,
      route_seq: route.routeSeq,
      route_code: `${code}`,
      route_orig_tc: route.routeOrigTC,
      route_orig_sc: route.routeOrigSC,
      route_orig_en: route.routeOrigEN,
      route_dest_tc: route.routeDestTC,
      route_desc_sc: route.routeDestSC,
      route_dest_en: route.routeDestEN,
      region: `${region}`
    });
  }

  batch.set(
    routeCodeDocRef,
    { route_ids: routeIds },
    { merge: true }
  );

  await batch.commit();
};

const insertStops = async (code, region, routeId, stopInfos) => {
  const batch = db.batch();
  const routeDocRef = db.doc(
    `${ROUTE_CODES_COLLECTION}/${code}_${region}/${ROUTES_COLLECTION}/${routeId}`
  );

  const stopIds = [];

  for (const info of stopInfos) {
    stopIds.push(info.stopId);

    const stopDocRef = db.doc(
      `${ROUTE_CODES_COLLECTION}/${code}_${region}/` +
      `${ROUTES_COLLECTION}/${routeId}/${STOP_COLLECTION}/${info.stopId}`
    );

    console.log(`code: ${code}\tStop: ${info.stopId}`);

    const hash = geofire.geohashForLocation([info.latitude, info.longitude]);
    const geopoint = new admin.firestore.GeoPoint(info.latitude, info.longitude);

    batch.set(stopDocRef, {
      stop_id: info.stopId,
      route_id: routeId,
      geohash: hash,
      location: geopoint,
    });
  }

  batch.set(
    routeDocRef,
    { stop_ids: stopIds },
    { merge: true }
  );

  await batch.commit();
};

// eslint-disable-next-line no-unused-vars
module.exports = async (context) => {
  // Fetch and insert codes
  const codes = await getCodes();
  await insertCodes(codes);

  for (const code of codes) {
    // Find the routes of each code.
    const routes = await getRoutes(code.code, code.region);
    await insertRoutes(code.code, code.region, routes);

    for (const route of routes) {
      // Find the stops of each route.
      const stops = await getStops(route.routeId, route.routeSeq);

      // Get the stop coords of each stop.
      const getStopInfosPromises = stops.map(async (stop) => {
        const coords = await getStopCoords(stop.stopId);
        return {
          stopId: stop.stopId,
          latitude: coords.latitude,
          longitude: coords.longitude
        };
      });

      const stopInfos = await Promise.all(getStopInfosPromises);
      await insertStops(code.code, code.region, route.routeId, stopInfos);
    }
  }
};
